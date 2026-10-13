import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { app } from 'electron';
import { NO_AGENT_PROCESS, type AgentAskContext, type AgentAskModel, type AgentImage, type AgentAskEvent, type AgentAskMessage, type AgentDecision, type AgentEvent, type AgentHost, type AgentReviewEvent, type AgentReviewRequest, type AgentRunOptions, type SetupChoice, type StartWorkspace } from '../../src/host/types/agent.ts';
import { classifyWithModel } from '../../src/drift.ts';
import type { Provider, Thread } from '../../src/model.ts';
import { askClaude, classifyClaude, claudeLimits, warmClaude } from '../agents/claude/oneshot.ts';
import { claudeRewindPoint, claudeRunOptions, hasClaudeSession, interruptClaude, resolveClaude, rewindClaude, sendClaude, startClaude, stopClaude, stopClaudeSubagent } from '../agents/claude/sessions.ts';
import { CodexAdapter } from '../agents/codex/adapter.ts';
import { reviewClaude, type ReviewUpdate } from '../agents/review.ts';
import { accountFor, agentSettings, secondOpinionModel } from '../agents/config.ts';
import { limitsOf, recordLimits } from '../agents/limits.ts';
import { claudeUsageWindows } from '../../src/usage/limits.ts';
import { VERDICT_SCHEMA } from '../../src/secondOpinion/verdict.ts';
import { ask as askAgent, utility } from '../agents/ask.ts';
import { models } from '../agents/models.ts';
import { resolveRun } from '../../src/runtime/models.ts';
import { codexUrl, resolveToolCall } from '../mcp/server.ts';
import { UTILITY_TASKS, type UtilityTask } from '../../src/utility/prompts.ts';
import { emitAgentEvent, markBusy, markIdle } from '../agents/events.ts';
import { createWorktree } from './git.ts';
import { prepareWorktree } from '../git/setup.ts';
import { Starts } from '../agents/starts.ts';
import { switchBranch } from '../git/branches.ts';
import { runGit, topLevel } from '../git/run.ts';
import { MAX_MODEL_CHARS, notImplemented, record, string, type Handlers } from './handlers.ts';

let nextId = 0;
const PROVIDERS = ['claude', 'codex'];
const DECISIONS = ['allow', 'deny', 'answer'];
// The renderer caps quotes at 8000 chars and activity at 12 × 600; these bound what a renderer can make main send.
const MAX_MESSAGE_CHARS = 20_000;
const MAX_CONTEXT_CHARS = 50_000;
const MAX_IMAGES = 8;
// Claude rejects images over 5 MB; base64 runs 4/3 of that.
const MAX_IMAGE_CHARS = 6_900_000;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function images(value: unknown) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > MAX_IMAGES) throw new TypeError(`images must be an array of up to ${MAX_IMAGES}`);
  for (const v of value) {
    const image = record(v, 'image');
    if (!IMAGE_TYPES.includes(image.mediaType as string)) throw new TypeError(`image.mediaType must be one of ${IMAGE_TYPES.join(', ')}`);
    string(image.data, 'image.data', MAX_IMAGE_CHARS);
  }
}

const MAX_SKILLS = 16;

function skillNames(value: unknown) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > MAX_SKILLS) throw new TypeError(`skills must be an array of up to ${MAX_SKILLS}`);
  for (const v of value) string(v, 'skill', 256);
}

// Threads without a Claude or Codex session run on the renderer's demo adapter.
const runtime = notImplemented('agent runtime');
const broadcast = emitAgentEvent;
// Codex review threads report like any thread; their events go to the review that owns them, never to the store.
const reviewers = new Map<string, (event: AgentEvent) => void>();
const codex = new CodexAdapter(
  (event) => {
    const reviewer = reviewers.get(event.threadId);
    if (reviewer) reviewer(event);
    else broadcast(event);
  },
  undefined,
  undefined,
  codexUrl,
);
codex.onLimits = (accountId, windows) => void recordLimits(accountId, 'codex', windows);
app.on('will-quit', () => codex.dispose());
const ASKERS = { claude: askClaude, codex: codex.ask.bind(codex) };
const starts = new Starts();
// A Mochi background agent's session id, `<thread>--<agent>` (`backgroundSession` in src/runtime/subagents.ts).
const isBackgroundSession = (threadId: string) => threadId.includes('--');

export const agent = {
  async start(_sender, threadId, options) {
    return startAgent(threadId, options);
  },
  async send(_sender, threadId, text, pictures, skills, speed) {
    string(threadId, 'threadId', 256);
    string(text, 'text', 100_000);
    images(pictures);
    skillNames(skills);
    if (speed !== undefined) string(speed, 'speed', 256);
    // Sent while the worktree is being set up: it goes to the agent once that start is through.
    await starts.wait(threadId as string);
    const run = claudeRunOptions(threadId as string) ?? codex.runOptions(threadId as string);
    if (!run) throw new Error(NO_AGENT_PROCESS);
    // '' is standard; a tier the running model doesn't list runs standard too.
    const tier = speed === undefined ? undefined : ((await offered(run.provider, run.spaceId, run.model, undefined, speed as string)).speed ?? '');
    markBusy(threadId as string);
    if (hasClaudeSession(threadId as string)) return sendClaude(threadId as string, text as string, pictures as AgentImage[] | undefined, tier);
    return codex.send(threadId as string, text as string, pictures as AgentImage[] | undefined, skills as string[] | undefined, tier);
  },
  async interrupt(_sender, threadId) {
    string(threadId, 'threadId', 256);
    if (starts.abort(threadId as string)) return;
    if (hasClaudeSession(threadId as string)) return interruptClaude(threadId as string);
    if (codex.owns(threadId as string)) return codex.interrupt(threadId as string);
    // Nothing running for this thread (already stopped, or never started this launch): nothing to interrupt.
  },
  async setupChoice(_sender, threadId, choice) {
    string(threadId, 'threadId', 256);
    if (choice !== 'retry' && choice !== 'skip') throw new TypeError('choice must be retry or skip');
    if (!starts.choose(threadId as string, choice as SetupChoice)) throw new Error("This thread's worktree setup isn't waiting on you");
  },
  async resolve(_sender, requestId, decision) {
    return resolveRequest(requestId, decision);
  },
  async stop(_sender, threadId) {
    string(threadId, 'threadId', 256);
    markIdle(threadId as string);
    starts.abort(threadId as string);
    if (hasClaudeSession(threadId as string)) return stopClaude(threadId as string);
    if (codex.owns(threadId as string)) return codex.stop(threadId as string);
    // Stopping a thread with no agent process is a no-op, so settling twice or settling then deleting never errors.
  },
  async stopSubagent(_sender, threadId, subagentId) {
    string(threadId, 'threadId', 256);
    string(subagentId, 'subagentId', 256);
    if (hasClaudeSession(threadId as string)) return stopClaudeSubagent(threadId as string, subagentId as string);
    if (codex.owns(threadId as string)) return codex.stopSubagent(threadId as string, subagentId as string);
    // Its parent's process is gone, so the subagent already stopped with it.
  },
  async warm(_sender, spaceId) {
    return warmClaude(string(spaceId, 'spaceId', 256));
  },
  async models(_sender, provider, spaceId) {
    if (!PROVIDERS.includes(provider as string)) throw new TypeError('provider must be claude or codex');
    return models(codex, provider as Provider, string(spaceId, 'spaceId', 256));
  },
  async limits(_sender, provider, spaceId, refresh) {
    if (!PROVIDERS.includes(provider as string)) throw new TypeError('provider must be claude or codex');
    string(spaceId, 'spaceId', 256);
    if (refresh) await refreshLimits(provider as Provider, spaceId as string).catch((error) => console.warn(`Could not read ${provider as Provider} limits`, error));
    return limitsOf((await accountFor(spaceId as string, provider as Provider)).account.id, provider as Provider);
  },
  async rewindFiles(_sender, threadId, text) {
    string(threadId, 'threadId', 256);
    string(text, 'text', 100_000);
    if (hasClaudeSession(threadId as string)) return rewindClaude(threadId as string, text as string);
  },
  async rewindPoint(_sender, threadId, text) {
    string(threadId, 'threadId', 256);
    string(text, 'text', 100_000);
    if (hasClaudeSession(threadId as string)) return claudeRewindPoint(threadId as string, text as string);
    return codex.rewindPoint(threadId as string, text as string);
  },
  async ask(sender, context, messages, model) {
    const m = record(model, 'model');
    if (!PROVIDERS.includes(m.provider as string)) throw new TypeError('model.provider must be claude or codex');
    if (m.model !== undefined) string(m.model, 'model.model', MAX_MODEL_CHARS);
    const c = record(context, 'context');
    string(c.spaceId, 'context.spaceId', 256);
    if (JSON.stringify(c).length > MAX_CONTEXT_CHARS) throw new TypeError(`context must be under ${MAX_CONTEXT_CHARS} chars`);
    if (!Array.isArray(messages) || messages.length > 200) throw new TypeError('messages must be an array of up to 200');
    for (const m of messages) {
      const message = record(m, 'message');
      if (message.role !== 'user' && message.role !== 'assistant') throw new TypeError('message.role must be user or assistant');
      string(message.text, 'message.text', MAX_MESSAGE_CHARS);
    }
    const id = `ask-${++nextId}`;
    const send = (event: AgentAskEvent) => !sender.isDestroyed() && sender.send('agent:onAskEvent', event);
    const abort = new AbortController();
    sender.once('destroyed', () => abort.abort());
    void (async () => {
      try {
        const { model } = await offered(m.provider as Provider, c.spaceId as string, m.model as string | undefined, undefined);
        for await (const text of askAgent(ASKERS, c as unknown as AgentAskContext, messages as AgentAskMessage[], { provider: m.provider, model } as AgentAskModel, abort)) send({ id, type: 'text', text });
        send({ id, type: 'done', text: '' });
      } catch (error) {
        send({ id, type: 'error', text: error instanceof Error ? error.message : String(error) });
      }
    })();
    return { id };
  },
  async review(sender, request) {
    const r = record(request, 'request');
    if (!PROVIDERS.includes(r.provider as string)) throw new TypeError('request.provider must be claude or codex');
    string(r.spaceId, 'request.spaceId', 256);
    string(r.prompt, 'request.prompt', 100_000);
    const run = { ...r, cwd: await agentFolder('review', string(r.cwd, 'request.cwd')) } as AgentReviewRequest;
    const id = `review-${++nextId}`;
    const send = (event: AgentReviewEvent) => !sender.isDestroyed() && sender.send('agent:onReviewEvent', event);
    const abort = new AbortController();
    sender.once('destroyed', () => abort.abort());
    void (async () => {
      try {
        const { model } = await offered(run.provider, run.spaceId, secondOpinionModel(run.provider), undefined);
        for await (const update of run.provider === 'claude' ? reviewClaude(run, abort, model) : reviewCodex(id, run, abort.signal, model)) send(update.type === 'step' ? { id, type: 'step', text: update.text } : { id, type: 'done', result: update.result });
      } catch (error) {
        send({ id, type: 'error', text: error instanceof Error ? error.message : String(error) });
      }
    })();
    return { id };
  },
  async toolResult(_sender, id, result) {
    string(id, 'id', 256);
    const r = record(result, 'result');
    string(r.text, 'result.text', MAX_CONTEXT_CHARS);
    if (r.isError !== undefined && typeof r.isError !== 'boolean') throw new TypeError('result.isError must be a boolean');
    resolveToolCall(id as string, { text: r.text as string, isError: r.isError as boolean | undefined, ...(r.image !== undefined && { image: imageOf(r.image) }) });
  },
  async utility(_sender, task, spaceId, prompt) {
    if (!(UTILITY_TASKS as readonly unknown[]).includes(task)) throw new TypeError('task must be a background task');
    string(spaceId, 'spaceId', 256);
    string(prompt, 'prompt', 40_000);
    const offers = (provider: Provider) => models(codex, provider, spaceId as string).then((list) => list.map((m) => m.id), () => []);
    const startedAt = performance.now();
    const answer = await utility(ASKERS, offers, agentSettings().utilityModels[task as UtilityTask], spaceId as string, task as UtilityTask, prompt as string);
    console.info(`utility ${task as string}: ${answer ? `${answer.provider} ${answer.model}` : 'no model answered, local fallback'} in ${Math.round(performance.now() - startedAt)}ms`);
    return answer?.text ?? null;
  },
  async classify(_sender, prompt, thread) {
    string(prompt, 'prompt', 20_000);
    const t = record(thread, 'thread');
    string(t.title, 'thread.title');
    string(t.goal, 'thread.goal', 20_000);
    if (!Array.isArray(t.steps)) throw new TypeError('thread.steps must be an array');
    for (const s of t.steps) {
      const step = record(s, 'step');
      string(step.title, 'step.title');
      string(step.status, 'step.status', 32);
      if (!Array.isArray(step.footprint) || step.footprint.some((f) => typeof f !== 'string')) throw new TypeError('step.footprint must be strings');
    }
    if (!Array.isArray(t.activity)) throw new TypeError('thread.activity must be an array');
    string(t.spaceId, 'thread.spaceId', 256);
    return classifyWithModel(prompt as string, t as unknown as Thread, (signal) => classifyClaude(prompt as string, t as unknown as Thread, signal));
  },
} satisfies Handlers<AgentHost>;

/** Answers a pending approval or question, from the renderer or a notification's buttons. */
export async function resolveRequest(requestId: unknown, decision: unknown) {
  string(requestId, 'requestId', 256);
  const d = record(decision, 'decision');
  if (!DECISIONS.includes(d.kind as string)) throw new TypeError('decision.kind must be allow, deny or answer');
  if (d.kind === 'answer' && (!Array.isArray(d.answers) || d.answers.some((a) => typeof a !== 'string'))) throw new TypeError('decision.answers must be strings');
  if (d.kind === 'deny' && d.message !== undefined) string(d.message, 'decision.message', 4096);
  if (resolveClaude(requestId as string, d as unknown as AgentDecision)) return;
  for (const key of ['forSession', 'interrupt']) if (d[key] !== undefined && typeof d[key] !== 'boolean') throw new TypeError(`decision.${key} must be a boolean`);
  if (codex.ownsRequest(requestId as string)) return codex.resolve(requestId as string, d as unknown as AgentDecision);
  return runtime();
}

/** Starts a thread's agent from options the renderer (or the scheduler) built; both go through the same checks. */
export async function startAgent(threadId: unknown, options: unknown) {
  string(threadId, 'threadId', 256);
  const o = record(options, 'options');
  if (!PROVIDERS.includes(o.provider as string)) throw new TypeError('options.provider must be claude or codex');
  string(o.spaceId, 'options.spaceId', 256);
  string(o.prompt, 'options.prompt', 100_000);
  for (const key of ['model', 'effort', 'speed', 'permissionMode', 'resume', 'forkAt']) if (o[key] !== undefined) string(o[key], `options.${key}`, 256);
  if (o.useApiKey !== undefined && typeof o.useApiKey !== 'boolean') throw new TypeError('options.useApiKey must be a boolean');
  if (o.useApiKey && o.provider !== 'claude') throw new TypeError('Only Claude threads can continue on an API key');
  images(o.images);
  skillNames(o.skills);
  // `speed` goes only through `offered`, which drops one the model doesn't list.
  const { workspace, worktree, speed, ...rest } = o;
  const id = threadId as string;
  const start = starts.begin(id);
  markBusy(id);
  const launch = async (cwd: string) => {
    const run = { ...rest, cwd, ...(await offered(o.provider as Provider, o.spaceId as string, o.model as string | undefined, o.effort as string | undefined, speed as string | undefined)) } as unknown as AgentRunOptions;
    if (o.provider === 'claude') return startClaude(id, run);
    return codex.start(id, run);
  };
  let isSettingUp = false;
  try {
    const folder = await agentFolder(id, o.cwd);
    const { cwd, setup } = await workspaceFolder(id, folder, startWorkspace(workspace, worktree), start);
    if (!setup) return await launch(cwd);
    // The renderer runs agent calls one after another, so a start that waited out the setup would hold back the Stop (and
    // every other thread's calls) behind it. It returns here; the setup and the launch report through events.
    isSettingUp = true;
    void setup
      .then(() => {
        if (!start.signal.aborted) return launch(cwd);
        markIdle(id);
        broadcast({ threadId: id, type: 'turn-end', status: 'interrupted' });
      })
      .catch((error: unknown) => {
        markIdle(id);
        broadcast({ threadId: id, type: 'turn-end', status: 'failed', error: error instanceof Error ? error.message : String(error) });
      })
      .finally(start.end);
  } catch (error) {
    markIdle(id);
    throw error;
  } finally {
    if (!isSettingUp) start.end();
  }
}

// Claude's read starts a Claude Code process, so a hover reads at most once a minute per profile.
const REFRESH_MS = 60_000;
const refreshedAt = new Map<string, number>();

async function refreshLimits(provider: Provider, spaceId: string) {
  const key = `${provider}:${spaceId}`;
  if (Date.now() - (refreshedAt.get(key) ?? 0) < REFRESH_MS) return;
  refreshedAt.set(key, Date.now());
  if (provider === 'codex') {
    const { accountId, windows } = await codex.readLimits(spaceId);
    return recordLimits(accountId, 'codex', windows, true);
  }
  const read = await claudeLimits(spaceId);
  if (read) await recordLimits(read.accountId, 'claude', claudeUsageWindows(read.rateLimits), true);
}

/**
 * The model, effort and speed a run sends: always an explicit model the account offers, and a speed only that model lists.
 * A list that can't be read passes model and effort through (the run then reports the provider's own error) and drops the speed.
 */
async function offered(provider: Provider, spaceId: string, model: string | undefined, effort: string | undefined, speed?: string) {
  return resolveRun(await models(codex, provider, spaceId).catch(() => []), model, effort, speed);
}

/** A Codex review on a thread of its own: tool starts become steps, the turn's last message is the answer. */
async function* reviewCodex(id: string, request: AgentReviewRequest, signal: AbortSignal, model: string | undefined): AsyncGenerator<ReviewUpdate> {
  const updates: (ReviewUpdate | Error)[] = [];
  let wake = () => {};
  let answer = '';
  reviewers.set(id, (event) => {
    if (event.type === 'message') answer = event.isDelta ? answer + event.text : event.text;
    else if (event.type === 'tool' && event.phase === 'start') updates.push({ type: 'step', text: event.text });
    else if (event.type === 'turn-end') updates.push(event.status === 'done' ? { type: 'done', result: answer } : new Error(event.error ?? `Codex review ${event.status}`));
    wake();
  });
  signal.addEventListener('abort', () => wake(), { once: true });
  try {
    await codex.review(id, { provider: 'codex', spaceId: request.spaceId, cwd: request.cwd, prompt: request.prompt, model }, VERDICT_SCHEMA);
    while (!signal.aborted) {
      const update = updates.shift();
      if (!update) {
        await new Promise<void>((resolve) => (wake = resolve));
        continue;
      }
      if (update instanceof Error) throw update;
      yield update;
      if (update.type === 'done') return;
    }
  } finally {
    reviewers.delete(id);
    await codex.stop(id).catch(() => {});
  }
}

/** The project folder, checked to exist; a folderless chat (null) gets its own folder, so the agent never runs in Mochi's cwd (`/` when packaged). */
async function agentFolder(threadId: string, cwd: unknown) {
  if (cwd === null) {
    if (!/^[\w-]+$/.test(threadId)) throw new TypeError('threadId must be letters, digits, - or _');
    const dir = join(homedir(), '.harness', 'chats', threadId);
    await mkdir(dir, { recursive: true });
    return dir;
  }
  const dir = string(cwd, 'options.cwd');
  if (!isAbsolute(dir)) throw new TypeError(`The project folder must be an absolute path, not "${dir}"`);
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`The project folder ${dir} doesn't exist anymore`);
  return dir;
}

/** Checks `options.workspace`; a trigger saved before workspaces carries `worktree: <branch>` instead. */
export function startWorkspace(value: unknown, legacyWorktree?: unknown): StartWorkspace | undefined {
  if (value === undefined) return legacyWorktree === undefined ? undefined : { mode: 'worktree', branch: string(legacyWorktree, 'options.worktree', 255) };
  const w = record(value, 'options.workspace');
  if (w.mode !== 'worktree' && w.mode !== 'folder') throw new TypeError('options.workspace.mode must be worktree or folder');
  if (w.isExisting !== undefined && typeof w.isExisting !== 'boolean') throw new TypeError('options.workspace.isExisting must be a boolean');
  return { mode: w.mode, branch: string(w.branch, 'options.workspace.branch', 255), base: w.base === undefined ? undefined : string(w.base, 'options.workspace.base', 255), isExisting: w.isExisting as boolean | undefined };
}

/**
 * The folder the agent runs in. A worktree thread gets its own worktree, so the panes and the agent see the same files (a folder
 * that isn't a git repo runs the agent in place, but a refused existing branch fails the start). A project folder thread runs in
 * the project's checkout, switched to its branch first when it chose one; a dirty checkout refuses the switch.
 */
async function workspaceFolder(threadId: string, root: string, workspace: StartWorkspace | undefined, start: ReturnType<Starts['begin']>): Promise<{ cwd: string; setup?: Promise<unknown> }> {
  if (!workspace) return { cwd: root };
  if (workspace.mode === 'folder') {
    const top = await topLevel(root).catch(() => null);
    if (!top) return { cwd: root };
    if (workspace.isExisting) await switchBranch(top, workspace.branch, { changes: 'refuse' });
    // On a detached HEAD the thread shows the commit, as git does, never the name it was created with: that branch doesn't exist.
    const branch = (await runGit(top, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { okCodes: [1] })).trim() || (await runGit(top, ['rev-parse', '--short', 'HEAD'], { okCodes: [128] })).trim();
    if (branch) broadcast({ threadId, type: 'branch', branch });
    return { cwd: root };
  }
  const isRepo = await topLevel(root).then(
    () => true,
    () => false,
  );
  if (!isRepo) {
    console.warn(`No worktree for ${threadId}: ${root} isn't a git repo, running there`);
    return { cwd: root };
  }
  const { dir, isNew } = await createWorktree(root, threadId, workspace.branch, workspace);
  broadcast({ threadId, type: 'worktree', path: dir });
  const settings = agentSettings();
  if (!isNew || !settings.prepareWorktrees) return { cwd: dir };
  const setup = topLevel(root).then((top) =>
    prepareWorktree({
      root: top,
      dir,
      include: settings.worktreeInclude,
      command: settings.setupCommands[root],
      emit: (setup) => broadcast({ threadId, type: 'setup', setup }),
      // A background agent's setup has no row to answer from: a failed step is skipped.
      choose: isBackgroundSession(threadId) ? () => Promise.resolve('skip') : start.choose,
      signal: start.signal,
    }),
  );
  return { cwd: dir, setup };
}

function imageOf(value: unknown) {
  const image = record(value, 'result.image');
  if (image.mimeType !== 'image/png') throw new TypeError('result.image.mimeType must be image/png');
  const data = string(image.data, 'result.image.data', MAX_IMAGE_CHARS);
  if (!/^[A-Za-z0-9+/]+=*$/.test(data)) throw new TypeError('result.image.data must be base64');
  return { data, mimeType: 'image/png' as const };
}
