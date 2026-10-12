import path from 'node:path';
import type { AgentEvent, AgentPlanItem } from '../../../src/host/types/agent.ts';
import type { AgentInfo, McpServer } from '../../../src/model.ts';
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
  /** The Codex account the thread runs on; it prefixes request ids so answers route back to that account's server. */
  account: string;
  /** Shared by every thread on the account: rate limits are account-wide and arrive without a thread id. */
  limits: AccountLimits;
}

type Totals = { input: number; cached: number; output: number };

/** When the account's most-used rate-limit window resets, in unix seconds. */
export interface AccountLimits {
  resetsAt?: number;
}

export function threadState(threadId: string, cwd: string, { isResumed = false, account = 'default', limits = {} as AccountLimits } = {}): ThreadState {
  return { threadId, cwd, streamed: new Set(), changes: new Map(), total: isResumed ? null : { input: 0, cached: 0, output: 0 }, account, limits };
}

/** Folds an `account/rateLimits/updated` snapshot in. Updates are sparse: a missing window keeps what was known. */
export function updateLimits(limits: AccountLimits, params: unknown) {
  const snapshot = obj(obj(params)?.rateLimits);
  const windows = [obj(snapshot?.primary), obj(snapshot?.secondary)].filter((w) => typeof w?.usedPercent === 'number' && typeof w.resetsAt === 'number');
  const binding = windows.sort((a, b) => (b!.usedPercent as number) - (a!.usedPercent as number))[0];
  if (binding) limits.resetsAt = binding.resetsAt as number;
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
      const error = obj(turn?.error);
      const end: AgentEvent = { threadId, type: 'turn-end', status, ...(typeof error?.message === 'string' && { error: apiMessage(error.message) }) };
      // The thread waits on the same account until the reset; moving it to another account is never automatic.
      if (error?.codexErrorInfo !== 'usageLimitExceeded') return [end];
      const resetsAt = s.limits.resetsAt;
      return [{ threadId, type: 'limit', ...(resetsAt !== undefined && { resetsAt: new Date(resetsAt * 1000).toISOString() }) }, end];
    }
    case 'mcpServer/startupStatus/updated': {
      const status = STARTUP_STATUS[p.status as keyof typeof STARTUP_STATUS];
      return typeof p.name === 'string' && status ? [{ threadId, type: 'info', info: { mcpServers: [{ name: p.name, status }] } }] : [];
    }
    case 'serverRequest/resolved':
      return typeof p.requestId === 'string' || typeof p.requestId === 'number' ? [{ threadId, type: 'resolved', requestId: requestKey(s.account, p.requestId) }] : [];
  }
  return [];
}

/** What `thread/start` and `thread/resume` say about the session. Codex lists no built-in tools, so `tools` stays unset. */
export function infoFromStart(result: unknown): AgentInfo {
  const r = obj(result);
  const approval = typeof r?.approvalPolicy === 'string' ? r.approvalPolicy : obj(r?.approvalPolicy) ? 'granular' : undefined;
  const sandbox = obj(r?.sandbox)?.type;
  const version = obj(r?.thread)?.cliVersion;
  return {
    ...(typeof r?.model === 'string' && { model: r.model }),
    ...(typeof r?.cwd === 'string' && { cwd: r.cwd }),
    ...(approval && { permissionMode: [approval, sandbox].filter((x) => typeof x === 'string').join(' · ') }),
    ...(typeof version === 'string' && { version }),
  };
}

/** Folds the replies to `mcpServerStatus/list`, `skills/list` and `plugin/installed`; a list whose call failed is left out. */
export function infoFromLists(mcp: unknown, skills: unknown, plugins: unknown): AgentInfo {
  const info: AgentInfo = {};
  const servers = obj(mcp)?.data;
  if (Array.isArray(servers))
    info.mcpServers = servers.flatMap((x): McpServer[] => {
      const o = obj(x);
      if (typeof o?.name !== 'string') return [];
      const status = CONNECTION_STATUS[o.runtimeStatus as keyof typeof CONNECTION_STATUS] ?? (o.authStatus === 'notLoggedIn' ? 'needs-auth' : 'pending');
      return [{ name: o.name, status, toolCount: Object.keys(obj(o.tools) ?? {}).length }];
    });
  const entries = obj(skills)?.data;
  if (Array.isArray(entries)) info.skills = [...new Set(entries.flatMap((e) => (Array.isArray(obj(e)?.skills) ? (obj(e)!.skills as unknown[]) : [])).flatMap((x) => (obj(x)?.enabled !== false && typeof obj(x)?.name === 'string' ? [obj(x)!.name as string] : [])))];
  const marketplaces = obj(plugins)?.marketplaces;
  if (Array.isArray(marketplaces))
    info.plugins = marketplaces
      .flatMap((m) => (Array.isArray(obj(m)?.plugins) ? (obj(m)!.plugins as unknown[]) : []))
      .flatMap((x) => {
        const o = obj(x);
        if (!o?.installed || !o.enabled || typeof o.name !== 'string') return [];
        const version = o.localVersion ?? o.version;
        return [{ name: o.name, ...(typeof version === 'string' && { version }) }];
      });
  return info;
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
      // app-server's request_user_input has no multi-select flag; free text is always offered.
      return [{ text: o.question, options, multiSelect: false }];
    });
    return questions.length ? { threadId, type: 'question', requestId, questions } : null;
  }
  // How Codex asks before an MCP tool whose approval mode is `prompt` runs.
  if (method === 'mcpServer/elicitation/request' && p.mode === 'form') {
    return { threadId, type: 'approval', requestId, kind: 'tool', title: `Use ${typeof p.serverName === 'string' ? p.serverName : 'an MCP'} tool`, detail: typeof p.message === 'string' ? p.message : '' };
  }
  return null;
}

/** Harness-side id for a Codex server request: prefixed so the IPC layer can route `resolve` back to this adapter and account. */
export function requestKey(account: string, id: string | number) {
  return `codex:${account}:${typeof id}:${id}`;
}

const PLAN_STATUS = { pending: 'pending', inProgress: 'running', completed: 'done' } as const;
const CONNECTION_STATUS = { notStarted: 'pending', starting: 'pending', connected: 'connected', authenticationRequired: 'needs-auth', failed: 'failed', cancelled: 'failed', disabled: 'disabled' } as const satisfies Record<string, McpServer['status']>;
const STARTUP_STATUS = { starting: 'pending', ready: 'connected', failed: 'failed', cancelled: 'failed' } as const satisfies Record<string, McpServer['status']>;
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
