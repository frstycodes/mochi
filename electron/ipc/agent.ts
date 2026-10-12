import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { app } from 'electron';
import type { AgentAskContext, AgentAskModel, AgentImage, AgentAskEvent, AgentAskMessage, AgentDecision, AgentEvent, AgentHost, AgentReviewEvent, AgentReviewRequest, AgentRunOptions } from '../../src/host/types/agent.ts';
import { classifyWithModel } from '../../src/drift.ts';
import type { Provider, Thread } from '../../src/model.ts';
import { askClaude, classifyClaude, warmClaude } from '../agents/claude/oneshot.ts';
import { hasClaudeSession, interruptClaude, resolveClaude, rewindClaude, sendClaude, startClaude, stopClaude, stopClaudeSubagent } from '../agents/claude/sessions.ts';
import { CodexAdapter } from '../agents/codex/adapter.ts';
import { reviewClaude, type ReviewUpdate } from '../agents/review.ts';
import { secondOpinionModel } from '../agents/config.ts';
import { VERDICT_SCHEMA } from '../../src/secondOpinion/verdict.ts';
import { ask as askAgent } from '../agents/ask.ts';
import { models } from '../agents/models.ts';
import { resolveRun } from '../../src/runtime/models.ts';
import { codexUrl, resolveToolCall } from '../mcp/server.ts';
import { emitAgentEvent, markBusy, markIdle } from '../agents/events.ts';
import { addWorktree } from './git.ts';
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
const IMAGE_TYPES = ['image/jpeg', 'image/png'];

function images(value: unknown) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > MAX_IMAGES) throw new TypeError(`images must be an array of up to ${MAX_IMAGES}`);
  for (const v of value) {
    const image = record(v, 'image');
    if (!IMAGE_TYPES.includes(image.mediaType as string)) throw new TypeError('image.mediaType must be image/jpeg or image/png');
    string(image.data, 'image.data', MAX_IMAGE_CHARS);
  }
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
app.on('will-quit', () => codex.dispose());
const ASKERS = { claude: askClaude, codex: codex.ask.bind(codex) };

export const agent = {
  async start(_sender, threadId, options) {
    return startAgent(threadId, options);
  },
  async send(_sender, threadId, text, pictures) {
    string(threadId, 'threadId', 256);
    string(text, 'text', 100_000);
    images(pictures);
    markBusy(threadId as string);
    if (hasClaudeSession(threadId as string)) return sendClaude(threadId as string, text as string, pictures as AgentImage[] | undefined);
    if (codex.owns(threadId as string)) return codex.send(threadId as string, text as string, pictures as AgentImage[] | undefined);
    return runtime();
  },
  async interrupt(_sender, threadId) {
    string(threadId, 'threadId', 256);
    if (hasClaudeSession(threadId as string)) return interruptClaude(threadId as string);
    if (codex.owns(threadId as string)) return codex.interrupt(threadId as string);
    return runtime();
  },
  async resolve(_sender, requestId, decision) {
    string(requestId, 'requestId', 256);
    const d = record(decision, 'decision');
    if (!DECISIONS.includes(d.kind as string)) throw new TypeError('decision.kind must be allow, deny or answer');
    if (d.kind === 'answer' && (!Array.isArray(d.answers) || d.answers.some((a) => typeof a !== 'string'))) throw new TypeError('decision.answers must be strings');
    if (d.kind === 'deny' && d.message !== undefined) string(d.message, 'decision.message', 4096);
    if (resolveClaude(requestId as string, d as unknown as AgentDecision)) return;
    for (const key of ['forSession', 'interrupt']) if (d[key] !== undefined && typeof d[key] !== 'boolean') throw new TypeError(`decision.${key} must be a boolean`);
    if (codex.ownsRequest(requestId as string)) return codex.resolve(requestId as string, d as unknown as AgentDecision);
    return runtime();
  },
  async stop(_sender, threadId) {
    string(threadId, 'threadId', 256);
    markIdle(threadId as string);
    if (hasClaudeSession(threadId as string)) return stopClaude(threadId as string);
    if (codex.owns(threadId as string)) return codex.stop(threadId as string);
    return runtime();
  },
  async stopSubagent(_sender, threadId, subagentId) {
    string(threadId, 'threadId', 256);
    string(subagentId, 'subagentId', 256);
    if (hasClaudeSession(threadId as string)) return stopClaudeSubagent(threadId as string, subagentId as string);
    if (codex.owns(threadId as string)) return codex.stopSubagent(threadId as string, subagentId as string);
    return runtime();
  },
  async warm(_sender, spaceId) {
    return warmClaude(string(spaceId, 'spaceId', 256));
  },
  async models(_sender, provider, spaceId) {
    if (!PROVIDERS.includes(provider as string)) throw new TypeError('provider must be claude or codex');
    return models(codex, provider as Provider, string(spaceId, 'spaceId', 256));
  },
  async rewindFiles(_sender, threadId, text) {
    string(threadId, 'threadId', 256);
    string(text, 'text', 100_000);
    if (hasClaudeSession(threadId as string)) return rewindClaude(threadId as string, text as string);
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
    string(t.spaceId, 'thread.spaceId', 256);
    return classifyWithModel(prompt as string, t as unknown as Thread, (signal) => classifyClaude(prompt as string, t as unknown as Thread, signal));
  },
} satisfies Handlers<AgentHost>;

/** Starts a thread's agent from options the renderer (or the scheduler) built; both go through the same checks. */
export async function startAgent(threadId: unknown, options: unknown) {
  string(threadId, 'threadId', 256);
  const o = record(options, 'options');
  if (!PROVIDERS.includes(o.provider as string)) throw new TypeError('options.provider must be claude or codex');
  string(o.spaceId, 'options.spaceId', 256);
  string(o.prompt, 'options.prompt', 100_000);
  for (const key of ['model', 'effort', 'permissionMode', 'resume']) if (o[key] !== undefined) string(o[key], `options.${key}`, 256);
  if (o.useApiKey !== undefined && typeof o.useApiKey !== 'boolean') throw new TypeError('options.useApiKey must be a boolean');
  if (o.useApiKey && o.provider !== 'claude') throw new TypeError('Only Claude threads can continue on an API key');
  images(o.images);
  const { worktree, ...rest } = o;
  const folder = await agentFolder(threadId as string, o.cwd);
  const cwd = worktree === undefined ? folder : await threadWorktree(threadId as string, folder, string(worktree, 'options.worktree', 255));
  markBusy(threadId as string);
  try {
    const run = { ...rest, cwd, ...(await offered(o.provider as Provider, o.spaceId as string, o.model as string | undefined, o.effort as string | undefined)) } as unknown as AgentRunOptions;
    if (o.provider === 'claude') return await startClaude(threadId as string, run);
    return await codex.start(threadId as string, run);
  } catch (error) {
    markIdle(threadId as string);
    throw error;
  }
}

/** The model and effort a run sends: always an explicit model the account offers. A list that can't be read passes the choice through; the run then reports the provider's own error. */
async function offered(provider: Provider, spaceId: string, model: string | undefined, effort: string | undefined) {
  return resolveRun(await models(codex, provider, spaceId).catch(() => []), model, effort);
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

/** Runs a project thread in its own worktree, so the panes and the agent see the same files; a folder that isn't a git repo runs the agent in place. */
async function threadWorktree(threadId: string, root: string, branch: string) {
  const path = await addWorktree(root, threadId, branch).catch((error: Error) => {
    console.warn(`No worktree for ${threadId} in ${root}, running there: ${error.message}`);
    return null;
  });
  if (path) broadcast({ threadId, type: 'worktree', path });
  return path ?? root;
}

function imageOf(value: unknown) {
  const image = record(value, 'result.image');
  if (image.mimeType !== 'image/png') throw new TypeError('result.image.mimeType must be image/png');
  const data = string(image.data, 'result.image.data', MAX_IMAGE_CHARS);
  if (!/^[A-Za-z0-9+/]+=*$/.test(data)) throw new TypeError('result.image.data must be base64');
  return { data, mimeType: 'image/png' as const };
}
