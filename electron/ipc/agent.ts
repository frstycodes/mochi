import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import type { AgentAskContext, AgentAskEvent, AgentAskMessage, AgentDecision, AgentEvent, AgentHost, AgentRunOptions } from '../../src/host/types/agent.ts';
import { classifyWithModel } from '../../src/drift.ts';
import type { Thread } from '../../src/model.ts';
import { askClaude, classifyClaude, warmClaude } from '../agents/claude/oneshot.ts';
import { hasClaudeSession, interruptClaude, resolveClaude, rewindClaude, sendClaude, startClaude, stopClaude } from '../agents/claude/sessions.ts';
import { CodexAdapter } from '../agents/codex/adapter.ts';
import { notImplemented, record, string, type Handlers } from './handlers.ts';

let nextId = 0;
const PROVIDERS = ['claude', 'codex'];
const DECISIONS = ['allow', 'deny', 'answer'];
// The renderer caps quotes at 8000 chars and activity at 12 × 600; these bound what a renderer can make main send.
const MAX_MESSAGE_CHARS = 20_000;
const MAX_CONTEXT_CHARS = 50_000;

// Threads without a Claude or Codex session run on the renderer's demo adapter.
const runtime = notImplemented('agent runtime');
const broadcast = (event: AgentEvent) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('agent:onEvent', event));
const codex = new CodexAdapter(broadcast);
app.on('will-quit', () => codex.dispose());

export const agent = {
  async start(_sender, threadId, options) {
    string(threadId, 'threadId', 256);
    const o = record(options, 'options');
    if (!PROVIDERS.includes(o.provider as string)) throw new TypeError('options.provider must be claude or codex');
    string(o.spaceId, 'options.spaceId', 256);
    string(o.prompt, 'options.prompt', 100_000);
    for (const key of ['model', 'effort', 'permissionMode', 'resume']) if (o[key] !== undefined) string(o[key], `options.${key}`, 256);
    if (o.useApiKey !== undefined && typeof o.useApiKey !== 'boolean') throw new TypeError('options.useApiKey must be a boolean');
    if (o.useApiKey && o.provider !== 'claude') throw new TypeError('Only Claude threads can continue on an API key');
    const run = { ...o, cwd: await agentFolder(threadId as string, o.cwd) } as unknown as AgentRunOptions;
    if (o.provider === 'claude') return startClaude(threadId as string, run);
    if (o.provider === 'codex') return codex.start(threadId as string, run);
    return runtime();
  },
  async send(_sender, threadId, text) {
    string(threadId, 'threadId', 256);
    string(text, 'text', 100_000);
    if (hasClaudeSession(threadId as string)) return sendClaude(threadId as string, text as string);
    if (codex.owns(threadId as string)) return codex.send(threadId as string, text as string);
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
    if (hasClaudeSession(threadId as string)) return stopClaude(threadId as string);
    if (codex.owns(threadId as string)) return codex.stop(threadId as string);
    return runtime();
  },
  async warm(_sender, spaceId) {
    return warmClaude(string(spaceId, 'spaceId', 256));
  },
  async rewindFiles(_sender, threadId, text) {
    string(threadId, 'threadId', 256);
    string(text, 'text', 100_000);
    if (hasClaudeSession(threadId as string)) return rewindClaude(threadId as string, text as string);
  },
  async ask(sender, context, messages) {
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
        for await (const text of askClaude(c.spaceId as string, c as unknown as AgentAskContext, messages as AgentAskMessage[], abort)) send({ id, type: 'text', text });
        send({ id, type: 'done', text: '' });
      } catch (error) {
        send({ id, type: 'error', text: error instanceof Error ? error.message : String(error) });
      }
    })();
    return { id };
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
