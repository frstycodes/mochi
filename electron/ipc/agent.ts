import { app, BrowserWindow } from 'electron';
import type { AgentAskContext, AgentAskEvent, AgentAskMessage, AgentDecision, AgentEvent, AgentHost, AgentStartOptions } from '../../src/host/types/agent.ts';
import { localClassifier } from '../../src/drift.ts';
import type { Thread } from '../../src/model.ts';
import { chunks, mockAnswer } from '../../src/sidechat/mockAnswer.ts';
import { hasClaudeSession, interruptClaude, resolveClaude, sendClaude, startClaude, stopClaude } from '../agents/claude/sessions.ts';
import { CodexAdapter } from '../agents/codex/adapter.ts';
import { notImplemented, record, string, type Handlers } from './handlers.ts';

let nextId = 0;
const PROVIDERS = ['claude', 'codex'];
const DECISIONS = ['allow', 'deny', 'answer'];

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
    string(o.cwd, 'options.cwd');
    string(o.spaceId, 'options.spaceId', 256);
    string(o.prompt, 'options.prompt', 100_000);
    for (const key of ['model', 'effort', 'permissionMode', 'resume']) if (o[key] !== undefined) string(o[key], `options.${key}`, 256);
    if (o.useApiKey !== undefined && typeof o.useApiKey !== 'boolean') throw new TypeError('options.useApiKey must be a boolean');
    if (o.useApiKey && o.provider !== 'claude') throw new TypeError('Only Claude threads can continue on an API key');
    if (o.provider === 'claude') return startClaude(threadId as string, o as unknown as AgentStartOptions);
    if (o.provider === 'codex') return codex.start(threadId as string, o as unknown as AgentStartOptions);
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
  async ask(sender, context, messages) {
    record(context, 'context');
    if (!Array.isArray(messages) || messages.length > 200) throw new TypeError('messages must be an array of up to 200');
    const id = `ask-${++nextId}`;
    const send = (event: AgentAskEvent) => !sender.isDestroyed() && sender.send('agent:onAskEvent', event);
    const parts = chunks(mockAnswer(context as unknown as AgentAskContext, messages as AgentAskMessage[]));
    parts.forEach((text, i) => setTimeout(() => send({ id, type: 'text', text }), 200 + i * 25));
    setTimeout(() => send({ id, type: 'done', text: '' }), 220 + parts.length * 25);
    return { id };
  },
  // GAP: R2 swaps in claude-haiku-5-5 with structured output; the local classifier answers until then.
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
    return localClassifier(prompt as string, t as unknown as Thread);
  },
} satisfies Handlers<AgentHost>;
