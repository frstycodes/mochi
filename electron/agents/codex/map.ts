import path from 'node:path';
import type { AgentEvent, AgentPlanItem } from '../../../src/host/types/agent.ts';
import { MODEL_PRICES } from '../../../src/usage/model.ts';

/** What the mapper remembers about one Codex thread between notifications. */
export interface ThreadState {
  threadId: string;
  cwd: string;
  /** Agent messages that already streamed deltas, so `item/completed` doesn't repeat them. */
  streamed: Set<string>;
  /** fileChange items by id, so a file approval can name the files it touches. */
  changes: Map<string, string[]>;
  /** Last cumulative token totals; usage events carry the difference because the store adds them up. Null after a resume, when the history's totals aren't ours to count again. */
  total: Totals | null;
}

type Totals = { input: number; cached: number; output: number };

export function threadState(threadId: string, cwd: string, isResumed = false): ThreadState {
  return { threadId, cwd, streamed: new Set(), changes: new Map(), total: isResumed ? null : { input: 0, cached: 0, output: 0 } };
}

/** The Codex thread a notification or server request belongs to, if any. */
export function codexThreadId(params: unknown): string | undefined {
  const id = obj(params)?.threadId;
  return typeof id === 'string' ? id : undefined;
}

export function mapNotification(method: string, params: unknown, s: ThreadState): AgentEvent[] {
  const p = obj(params);
  if (!p) return [];
  const threadId = s.threadId;
  switch (method) {
    case 'item/agentMessage/delta': {
      if (typeof p.itemId !== 'string' || typeof p.delta !== 'string') return [];
      // The first delta of an item opens a new activity entry; the store appends later deltas to it.
      const isDelta = s.streamed.has(p.itemId);
      s.streamed.add(p.itemId);
      return [{ threadId, type: 'message', text: p.delta, isDelta }];
    }
    case 'item/started':
    case 'item/completed':
      return mapItem(obj(p.item), method === 'item/started' ? 'start' : 'end', s);
    case 'turn/plan/updated': {
      if (!Array.isArray(p.plan)) return [];
      const items = p.plan.flatMap((step): AgentPlanItem[] => {
        const st = obj(step);
        const status = PLAN_STATUS[st?.status as keyof typeof PLAN_STATUS];
        return typeof st?.step === 'string' && status ? [{ title: st.step, status }] : [];
      });
      return [{ threadId, type: 'plan', items }];
    }
    case 'thread/tokenUsage/updated':
      return mapUsage(obj(p.tokenUsage), s);
    case 'turn/completed': {
      const turn = obj(p.turn);
      const status = TURN_STATUS[turn?.status as keyof typeof TURN_STATUS];
      if (!status) return [];
      const error = obj(turn?.error)?.message;
      return [{ threadId, type: 'turn-end', status, ...(typeof error === 'string' && { error: apiMessage(error) }) }];
    }
    case 'serverRequest/resolved':
      return typeof p.requestId === 'string' || typeof p.requestId === 'number' ? [{ threadId, type: 'resolved', requestId: requestKey(p.requestId) }] : [];
  }
  return [];
}

/** Server requests that become queue cards. Anything else gets a JSON-RPC error reply from the caller. */
export function mapRequest(method: string, params: unknown, requestId: string, s: ThreadState): AgentEvent | null {
  const p = obj(params);
  if (!p) return null;
  const threadId = s.threadId;
  const reason = typeof p.reason === 'string' ? p.reason : '';
  if (method === 'item/commandExecution/requestApproval') {
    const command = typeof p.command === 'string' ? p.command : undefined;
    return { threadId, type: 'approval', requestId, kind: 'command', title: 'Run a command', detail: reason || `In ${typeof p.cwd === 'string' ? p.cwd : s.cwd}`, ...(command && { code: command }) };
  }
  if (method === 'item/fileChange/requestApproval') {
    const files = typeof p.itemId === 'string' ? (s.changes.get(p.itemId) ?? []) : [];
    return { threadId, type: 'approval', requestId, kind: 'edit', title: files.length ? `Edit ${files.join(', ')}` : 'Edit files', detail: reason || 'Codex wants to apply a patch.', ...(files.length && { code: files.join('\n') }) };
  }
  if (method === 'item/tool/requestUserInput') {
    if (!Array.isArray(p.questions)) return null;
    const questions = p.questions.flatMap((q) => {
      const o = obj(q);
      if (typeof o?.question !== 'string') return [];
      const options = Array.isArray(o.options) ? o.options.flatMap((x) => (typeof obj(x)?.label === 'string' ? [obj(x)!.label as string] : [])) : [];
      return [{ text: o.question, options }];
    });
    return questions.length ? { threadId, type: 'question', requestId, questions } : null;
  }
  return null;
}

/** Harness-side id for a Codex server request: prefixed so the IPC layer can route `resolve` back to this adapter. */
export function requestKey(id: string | number) {
  return `codex:${typeof id}:${id}`;
}

const PLAN_STATUS = { pending: 'pending', inProgress: 'running', completed: 'done' } as const;
const TURN_STATUS = { completed: 'done', interrupted: 'interrupted', failed: 'failed' } as const;
// TODO(codex): threads don't report their model yet, so every Codex token is priced as the default model; cached input is left out of the cost.
const PRICE = MODEL_PRICES['gpt-5.5-codex'];

function mapItem(item: Record<string, unknown> | undefined, phase: 'start' | 'end', s: ThreadState): AgentEvent[] {
  if (!item || typeof item.id !== 'string') return [];
  const threadId = s.threadId;
  const id = item.id;
  switch (item.type) {
    case 'agentMessage':
      if (phase === 'start' || typeof item.text !== 'string' || s.streamed.delete(id)) return [];
      return [{ threadId, type: 'message', text: item.text, isDelta: false }];
    case 'reasoning': {
      const summary = Array.isArray(item.summary) ? item.summary.filter((x) => typeof x === 'string').join('\n\n') : '';
      return phase === 'end' && summary ? [{ threadId, type: 'reasoning', text: summary }] : [];
    }
    case 'commandExecution': {
      if (typeof item.command !== 'string') return [];
      const exitCode = typeof item.exitCode === 'number' ? item.exitCode : undefined;
      return [{ threadId, type: 'tool', id, phase, text: item.command, ...(phase === 'end' && exitCode !== undefined && { exitCode }) }];
    }
    case 'fileChange': {
      const files = Array.isArray(item.changes) ? item.changes.flatMap((c) => (typeof obj(c)?.path === 'string' ? [relative(s.cwd, obj(c)!.path as string)] : [])) : [];
      if (phase === 'start') s.changes.set(id, files);
      else s.changes.delete(id);
      return [{ threadId, type: 'tool', id, phase, text: `Edit ${files.join(', ') || 'files'}`, ...(phase === 'end' && item.status === 'completed' && { files }) }];
    }
    case 'mcpToolCall':
      return typeof item.server === 'string' && typeof item.tool === 'string' ? [{ threadId, type: 'tool', id, phase, text: `${item.server}: ${item.tool}` }] : [];
    case 'webSearch':
      return [{ threadId, type: 'tool', id, phase, text: typeof item.query === 'string' && item.query ? `Search the web: ${item.query}` : 'Search the web' }];
  }
  return [];
}

function mapUsage(usage: Record<string, unknown> | undefined, s: ThreadState): AgentEvent[] {
  const total = obj(usage?.total);
  const last = obj(usage?.last);
  if (typeof total?.inputTokens !== 'number' || typeof total.outputTokens !== 'number') return [];
  const now = { input: total.inputTokens, cached: num(total.cachedInputTokens), output: total.outputTokens };
  // After a resume, count only the request this update reports.
  const before = s.total ?? { input: now.input - num(last?.inputTokens), cached: now.cached - num(last?.cachedInputTokens), output: now.output - num(last?.outputTokens) };
  s.total = now;
  const inputTokens = Math.max(0, now.input - before.input);
  const outputTokens = Math.max(0, now.output - before.output);
  const uncached = Math.max(0, inputTokens - (now.cached - before.cached));
  const contextMax = typeof usage?.modelContextWindow === 'number' ? usage.modelContextWindow : undefined;
  const contextUsed = typeof last?.totalTokens === 'number' ? last.totalTokens : undefined;
  const costUsd = (uncached * PRICE.input + outputTokens * PRICE.output) / 1_000_000;
  return [{ threadId: s.threadId, type: 'usage', inputTokens, outputTokens, costUsd, ...(contextUsed !== undefined && { contextUsed }), ...(contextMax !== undefined && { contextMax }) }];
}

/** Upstream API errors arrive as their raw JSON body; show the message inside. */
function apiMessage(message: string) {
  try {
    const inner = obj(obj(JSON.parse(message))?.error)?.message;
    return typeof inner === 'string' ? inner : message;
  } catch {
    return message;
  }
}

function num(value: unknown) {
  return typeof value === 'number' ? value : 0;
}

function relative(cwd: string, file: string) {
  return path.isAbsolute(file) && file.startsWith(cwd + path.sep) ? path.relative(cwd, file) : file;
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
