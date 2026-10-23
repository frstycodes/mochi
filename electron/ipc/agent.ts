import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { app } from 'electron';
import { Effect } from 'effect';
import { coreClient } from '@mochi/core/host';
import { NO_AGENT_PROCESS, NO_PENDING_REQUEST, type AgentAskEvent, type AgentDecision, type AgentEvent, type AgentHost, type AgentReviewEvent, type AgentReviewRequest, type AgentRunOptions, type AgentStartOptions, type AgentToolResult, type StartWorkspace } from '../../src/host/types/agent.ts';
import { classifyWithModel } from '../../src/drift.ts';
import type { McpWidgetResource, Provider } from '../../src/model.ts';
import { askClaude, classifyClaude, claudeLimits, warmClaude } from '../agents/claude/oneshot.ts';
import { claudeRewindPoint, claudeRunOptions, readClaudeWidget, claudeSessionIds, compactClaude, hasClaudeSession, setClaudeCompactInstructions, interruptClaude, resolveClaude, rewindClaude, sendClaude, startClaude, unsteerClaude, stopClaude, stopClaudeTask } from '../agents/claude/sessions.ts';
import { CodexAdapter } from '../agents/codex/adapter.ts';
import { reviewClaude, type ReviewUpdate } from '../agents/review.ts';
import { accountFor, agentSettings, secondOpinionModel } from '../agents/config.ts';
import { limitsOf, recordLimits } from '../agents/limits.ts';
import { claudeUsageWindows } from '../../src/usage/limits.ts';
import { VERDICT_SCHEMA } from '../../src/secondOpinion/verdict.ts';
import { ask as askAgent, utility } from '../agents/ask.ts';
import { models } from '../agents/models.ts';
import { resolveRun } from '../../src/runtime/models.ts';
import { codexUrl, resolveToolCall, setImageGenerator, undeliveredToolCalls } from '../mcp/server.ts';
import { commandPrompt, parseTitle, type UtilityTask } from '../../src/utility/prompts.ts';
import { emitAgentEvent, eventsSince, forgetEvents, isBusy, markBusy, markIdle, onAgentEvent } from '../agents/events.ts';
import { createWorktree } from './git.ts';
import { prepareWorktree } from '../git/setup.ts';
import { Starts } from '../agents/starts.ts';
import { nameThread } from '../agents/naming.ts';
import { threadSessions } from '../agents/settle.ts';
import { killThreadSessions } from '../pty/sessions.ts';
import { stopCompare } from '../browser/compare.ts';
import { headOf, switchBranch } from '../git/branches.ts';
import { topLevel } from '../git/run.ts';
import { codexToolConfig } from '../../src/library/connectorTools.ts';
import { codexServerConfig } from '../../src/library/library.ts';
import { sessionConnectors, sessionToolRules } from '../library/connectors.ts';
import { sessionLibrary } from '../library/store.ts';
import { codexNativeConfig, offItems } from '../../src/library/nativeOverrides.ts';
import { readProfileConfig } from '../agents/profileConfig.ts';
import type { Handlers } from './handlers.ts';
import { profileInstructions } from '../agents/profileFolder.ts';

let nextId = 0;
// Claude rejects images over 5 MB; base64 runs 4/3 of that.
const MAX_IMAGE_CHARS = 6_900_000;

const broadcast = emitAgentEvent;

/** The live read, kept on disk so a view still opens once no Claude session runs (after a restart). The view's own scripts load from the network either way. */
async function readWidget(threadId: string, server: string, uri: string): Promise<McpWidgetResource> {
  const file = join(app.getPath('userData'), 'mcp-apps', `${createHash('sha256').update(`${server}\n${uri}`).digest('hex')}.json`);
  try {
    const resource = await readClaudeWidget(threadId, server, uri);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(resource));
    return resource;
  } catch (error) {
    const kept = await readFile(file, 'utf8').then((text) => JSON.parse(text) as McpWidgetResource, () => null);
    if (kept) return kept;
    throw error;
  }
}
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
  async ({ spaceId, cwd, nativeOff }) => {
    const [{ servers }, connectors, rules, native] = await Promise.all([sessionLibrary(spaceId, 'codex'), sessionConnectors(spaceId), sessionToolRules(spaceId), codexNativeOff(spaceId, cwd, nativeOff)]);
    const tools = Object.entries(rules).map(([key, keyRules]) => codexToolConfig(key, keyRules));
    const mochi = { ...codexServerConfig(servers), ...Object.fromEntries(connectors.map(([name, url]) => [`mcp_servers.${name}.url`, url])) };
    // A turned-off native server shares `mcp_servers.<name>` with a library server or connector of that name; Mochi's own stays on.
    const isMochis = (key: string) => Object.keys(mochi).some((k) => k.startsWith(key.replace(/enabled$/, '')));
    const kept = Object.fromEntries(Object.entries(native).filter(([key]) => !key.startsWith('mcp_servers.') || !isMochis(key)));
    return { ...kept, ...mochi, ...Object.assign({}, ...tools) };
  },
  (spaceId) => profileInstructions(spaceId, 'codex'),
);
// One model call per distinct command per launch: agents rerun the same `pnpm test` all day.
const commandTitles = new Map<string, Promise<string>>();
const MAX_COMMAND_TITLES = 500;

// Every thread's events pass here, Claude's and Codex's; a review thread's never do, and its calls stay undescribed.
onAgentEvent((event) => {
  if (event.type === 'tool' && event.command) void describeCommand(event.threadId, event.id, event.command);
});

/** A command its agent sent without a description (always on Codex, sometimes on Claude) gets one from the background model, for its row and the sidebar. */
async function describeCommand(threadId: string, id: string, command: string) {
  const spaceId = (claudeRunOptions(threadId) ?? codex.runOptions(threadId))?.spaceId;
  if (!spaceId) return;
  if (commandTitles.size >= MAX_COMMAND_TITLES) commandTitles.clear();
  let title = commandTitles.get(command);
  if (!title) {
    title = runUtility('command', spaceId, commandPrompt(command)).then((text) => (text && parseTitle(text)) || '', () => '');
    commandTitles.set(command, title);
  }
  const description = await title;
  if (description) broadcast({ threadId, type: 'tool-description', id, description });
}

/** The profile's turned-off Codex items as thread config, read from the account's config (the thread's project included). */
async function codexNativeOff(spaceId: string, cwd: string, ids: string[] | undefined) {
  if (!ids?.length) return {};
  return codexNativeConfig(offItems((await readProfileConfig(spaceId, cwd)).codex, ids));
}
codex.onLimits = (accountId, windows) => void recordLimits(accountId, 'codex', windows);
app.on('will-quit', () => codex.dispose());
const ASKERS = { claude: askClaude, codex: codex.ask.bind(codex) };
setImageGenerator('codex', codex.generateImage.bind(codex));
const starts = new Starts();
// A delegated task's session id, `<thread>--<agent>` (`backgroundSession` in src/runtime/subagents.ts).
const isBackgroundSession = (threadId: string) => threadId.includes('--');

export const agent = {
  async start(_sender, threadId, options) {
    return startAgent(threadId, options);
  },
  async send(_sender, threadId, text, pictures, skills, speed, steer, steerId) {
    // Sent while the worktree is being set up: it goes to the agent once that start is through.
    await starts.wait(threadId);
    const run = claudeRunOptions(threadId) ?? codex.runOptions(threadId);
    if (!run) throw new Error(NO_AGENT_PROCESS);
    // '' is standard; a tier the running model doesn't list runs standard too.
    const tier = speed === undefined ? undefined : ((await offered(run.provider, run.spaceId, run.model, undefined, speed)).speed ?? '');
    markBusy(threadId);
    if (hasClaudeSession(threadId)) return sendClaude(threadId, text, pictures, tier, steer === true, steerId);
    return codex.send(threadId, text, pictures, skills, tier, steer === true, steerId);
  },
  async unsteer(_sender, threadId, steerId) {
    if (hasClaudeSession(threadId)) return unsteerClaude(threadId, steerId);
    return codex.unsteer(threadId, steerId);
  },
  async compact(_sender, threadId, focus) {
    await starts.wait(threadId);
    if (!hasClaudeSession(threadId) && !codex.owns(threadId)) throw new Error(NO_AGENT_PROCESS);
    markBusy(threadId);
    if (hasClaudeSession(threadId)) return compactClaude(threadId, focus);
    return codex.compact(threadId);
  },
  async compactInstructions(_sender, threadId, instructions) {
    setClaudeCompactInstructions(threadId, instructions);
  },
  async interrupt(_sender, threadId) {
    if (starts.abort(threadId)) return;
    if (hasClaudeSession(threadId)) return interruptClaude(threadId);
    if (codex.owns(threadId)) return codex.interrupt(threadId);
    // Nothing running for this thread (already stopped, or never started this launch): nothing to interrupt.
  },
  async setupChoice(_sender, threadId, choice) {
    if (!starts.choose(threadId, choice)) throw new Error("This thread's worktree setup isn't waiting on you");
  },
  async keepTitle(_sender, threadId) {
    starts.keepTitle(threadId);
  },
  async resolve(_sender, requestId, decision) {
    return resolveRequest(requestId, decision);
  },
  async stop(_sender, threadId) {
    return stopSession(threadId);
  },
  async settle(_sender, threadId) {
    const id = threadId;
    killThreadSessions(id);
    await Promise.all([...threadSessions(id, [...claudeSessionIds(), ...codex.threadIds(), ...starts.ids()]).map(stopSession), stopCompare(id)]);
  },
  async attached(_sender, threads) {
    return threads
      .filter((t) => hasClaudeSession(t.threadId) || codex.owns(t.threadId))
      .map(({ threadId, after }) => ({ threadId, isWorking: isBusy(threadId), events: after === undefined ? [] : eventsSince(threadId, after) }));
  },
  async stopTask(_sender, threadId, taskId) {
    if (hasClaudeSession(threadId)) return stopClaudeTask(threadId, taskId);
    if (codex.owns(threadId)) return codex.stopTask(threadId, taskId);
    // Its parent's process is gone, so the task already stopped with it.
  },
  async warm(_sender, spaceId) {
    return warmClaude(spaceId);
  },
  async models(_sender, provider, spaceId) {
    return models(codex, provider, spaceId);
  },
  async limits(_sender, provider, spaceId, refresh) {
    if (refresh) await refreshLimits(provider, spaceId).catch((error) => console.warn(`Could not read ${provider} limits`, error));
    return limitsOf((await accountFor(spaceId, provider)).account.id, provider);
  },
  async rewindFiles(_sender, threadId, text) {
    if (hasClaudeSession(threadId)) return rewindClaude(threadId, text);
  },
  async rewindPoint(_sender, threadId, text) {
    if (hasClaudeSession(threadId)) return claudeRewindPoint(threadId, text);
    return codex.rewindPoint(threadId, text);
  },
  async readWidget(_sender, threadId, server, uri) {
    return readWidget(threadId, server, uri);
  },
  async ask(sender, context, messages, asker) {
    const id = `ask-${++nextId}`;
    const send = (event: AgentAskEvent) => !sender.isDestroyed() && sender.send('agent:onAskEvent', event);
    const abort = new AbortController();
    sender.once('destroyed', () => abort.abort());
    void (async () => {
      try {
        const { model } = await offered(asker.provider, context.spaceId, asker.model, undefined);
        for await (const text of askAgent(ASKERS, context, messages, { provider: asker.provider, model }, abort)) send({ id, type: 'text', text });
        send({ id, type: 'done', text: '' });
      } catch (error) {
        send({ id, type: 'error', text: error instanceof Error ? error.message : String(error) });
      }
    })();
    return { id };
  },
  async review(sender, request) {
    const run = { ...request, cwd: await agentFolder('review', request.cwd) };
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
  async pendingToolCalls(sender) {
    return undeliveredToolCalls(sender);
  },
  async toolResult(_sender, id, result) {
    resolveToolCall(id, { text: result.text, isError: result.isError, ...(result.image !== undefined && { image: imageOf(result.image) }) });
  },
  async utility(_sender, task, spaceId, prompt) {
    return executeUtility(task, spaceId, prompt);
  },
  async classify(_sender, prompt, thread) {
    return classifyWithModel(prompt, thread, (signal) => classifyClaude(prompt, thread, signal));
  },
} satisfies Handlers<AgentHost>;

/** Queued in Core (`utility.run`), which calls `agent.utility` below when it is this job's turn. */
async function runUtility(task: UtilityTask, spaceId: string, prompt: string, thread?: string) {
  const client = await coreClient();
  return Effect.runPromise(client['utility.run']({ task, spaceId, prompt, thread }));
}

/** One model call, no queue: Core's executor for `utility.run`. */
async function executeUtility(task: UtilityTask, spaceId: string, prompt: string) {
  const offers = (provider: Provider) => models(codex, provider, spaceId).then((list) => list.map((m) => m.id), () => []);
  const startedAt = performance.now();
  const answer = await utility(ASKERS, offers, agentSettings().utilityModels[task], spaceId, task, prompt);
  console.info(`utility ${task}: ${answer ? `${answer.provider} ${answer.model}` : 'no model answered, local fallback'} in ${Math.round(performance.now() - startedAt)}ms`);
  return answer?.text ?? null;
}

/** Stopping a session with no agent process is a no-op, so settling twice or settling then deleting never errors. */
async function stopSession(threadId: string) {
  markIdle(threadId);
  forgetEvents(threadId);
  starts.abort(threadId);
  if (hasClaudeSession(threadId)) return stopClaude(threadId);
  return codex.stop(threadId);
}

/** Answers a pending approval or question, from the renderer or a notification's buttons. */
export async function resolveRequest(requestId: string, decision: AgentDecision) {
  if (resolveClaude(requestId, decision)) return;
  if (codex.ownsRequest(requestId)) return codex.resolve(requestId, decision);
  throw new Error(NO_PENDING_REQUEST);
}

/** Starts a thread's agent from options the renderer (or the scheduler) built. */
export async function startAgent(id: string, options: AgentStartOptions & { worktree?: string }) {
  // `speed` goes only through `offered`, which drops one the model doesn't list.
  const { workspace, worktree, speed, ...rest } = options;
  // A trigger saved before workspaces carries `worktree: <branch>` instead of `workspace`.
  const startsIn = workspace ?? (worktree === undefined ? undefined : ({ mode: 'worktree', branch: worktree } satisfies StartWorkspace));
  const start = starts.begin(id);
  markBusy(id);
  const launch = async (cwd: string) => {
    const run: AgentRunOptions = { ...rest, cwd, ...(await offered(options.provider, options.spaceId, options.model, options.effort, speed)) };
    if (options.provider === 'claude') return startClaude(id, run);
    return codex.start(id, run, start.signal);
  };
  let isLaunching = false;
  try {
    const folder = await agentFolder(id, options.cwd);
    const { cwd, setup, named } = await workspaceFolder(id, folder, startsIn, start, options.spaceId);
    // The renderer runs agent calls one after another, so a start that waited out the setup, or an app-server slow to answer,
    // would hold back the Stop (and every other thread's calls) behind it. It returns here; setup and launch report through events.
    isLaunching = true;
    void (setup ?? Promise.resolve())
      .then(() => named?.())
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
    if (!isLaunching) start.end();
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
async function agentFolder(threadId: string, cwd: string | null) {
  if (cwd === null) {
    if (!/^[\w-]+$/.test(threadId)) throw new TypeError('threadId must be letters, digits, - or _');
    const dir = join(homedir(), '.harness', 'chats', threadId);
    await mkdir(dir, { recursive: true });
    return dir;
  }
  const dir = cwd;
  if (!isAbsolute(dir)) throw new TypeError(`The project folder must be an absolute path, not "${dir}"`);
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`The project folder ${dir} doesn't exist anymore`);
  return dir;
}

/**
 * The folder the agent runs in. A worktree thread gets its own worktree, so the panes and the agent see the same files (a folder
 * that isn't a git repo runs the agent in place, but a refused existing branch fails the start). A project folder thread runs in
 * the project's checkout, switched to its branch first when it chose one; a dirty checkout refuses the switch. A new worktree
 * with a `title` is named after it, and one with a `titlePrompt` asks for its title during the setup; `named` waits for it once the setup is through.
 */
async function workspaceFolder(threadId: string, root: string, workspace: StartWorkspace | undefined, start: ReturnType<Starts['begin']>, spaceId: string): Promise<{ cwd: string; setup?: Promise<unknown>; named?: () => Promise<void> }> {
  if (!workspace) return { cwd: root };
  if (workspace.mode === 'folder') {
    const top = await topLevel(root).catch(() => null);
    if (!top) return { cwd: root };
    if (workspace.isExisting) await switchBranch(top, workspace.branch, { changes: 'refuse' });
    // The thread shows what the checkout really has, never the name it was created with: on a detached HEAD that branch doesn't exist.
    const head = await headOf(top).catch(() => null);
    if (head) broadcast({ threadId, type: 'branch', ...head });
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
  const title = !isNew ? undefined : workspace.title ? Promise.resolve(workspace.title) : workspace.titlePrompt ? runUtility('title', spaceId, workspace.titlePrompt, threadId).then((text) => (text && parseTitle(text)) || null, () => null) : undefined;
  const named = title && (() => nameThread(threadId, dir, workspace.branch, title, start, broadcast));
  const settings = agentSettings();
  if (!isNew || !settings.prepareWorktrees) return { cwd: dir, named };
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
  return { cwd: dir, setup, named };
}

function imageOf(image: NonNullable<AgentToolResult['image']>) {
  if (image.data.length > MAX_IMAGE_CHARS) throw new TypeError(`result.image.data must be under ${MAX_IMAGE_CHARS} chars`);
  if (!/^[A-Za-z0-9+/]+=*$/.test(image.data)) throw new TypeError('result.image.data must be base64');
  return image;
}
