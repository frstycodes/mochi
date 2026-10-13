import path from 'node:path';
import type { AgentEvent, AgentModel, AgentPlanItem, AgentSubagentEvent, LimitWindow } from '../../../src/host/types/agent.ts';
import type { AgentCommand, AgentInfo, McpServer, WebLink } from '../../../src/model.ts';
import { codexWindows, hottest, mergeWindows, nearLimit } from '../../../src/usage/limits.ts';

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

type Totals = { input: number; output: number; cached: number };

/** The account's plan windows as Codex last reported them, merged across sparse updates. */
export interface AccountLimits {
  windows?: LimitWindow[];
}

export function threadState(threadId: string, cwd: string, { isResumed = false, account = 'default', limits = {} as AccountLimits } = {}): ThreadState {
  return { threadId, cwd, streamed: new Set(), changes: new Map(), total: isResumed ? null : { input: 0, output: 0, cached: 0 }, account, limits };
}

/** Folds an `account/rateLimits/updated` snapshot in. Updates are sparse: a missing window keeps what was known. Returns the window now at `WARN_PCT` or more, if any. */
export function updateLimits(limits: AccountLimits, params: unknown) {
  limits.windows = mergeWindows(limits.windows ?? [], codexWindows(obj(obj(params)?.rateLimits) as Parameters<typeof codexWindows>[0]));
  return nearLimit(limits.windows);
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
      const binding = hottest(s.limits.windows ?? []);
      return [{ threadId, type: 'limit', ...(binding?.resetsAt && { resetsAt: binding.resetsAt }), ...(binding && { label: binding.label }) }, end];
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
  if (Array.isArray(obj(skills)?.data)) {
    info.commands = commandsFromSkills(skills);
    info.skills = info.commands.map((c) => c.name);
  }
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

/** The enabled skills in a `skills/list` reply, once each. Codex skills say nothing about their arguments. */
export function commandsFromSkills(reply: unknown): AgentCommand[] {
  const entries = obj(reply)?.data;
  if (!Array.isArray(entries)) return [];
  const byName = new Map<string, AgentCommand>();
  for (const x of entries.flatMap((e) => (Array.isArray(obj(e)?.skills) ? (obj(e)!.skills as unknown[]) : []))) {
    const o = obj(x);
    if (!o || o.enabled === false || typeof o.name !== 'string' || byName.has(o.name)) continue;
    const short = obj(o.interface)?.shortDescription ?? o.shortDescription;
    const description = typeof short === 'string' ? short : typeof o.description === 'string' ? o.description : '';
    byName.set(o.name, { name: o.name, description, ...(typeof o.path === 'string' && { path: o.path }) });
  }
  return [...byName.values()];
}

/**
 * The `skill` input items that make Codex load the skill a message opens with (`/name args`) and the ones named alongside it
 * (`@` in the composer): app-server takes no slash commands in text, its TUI attaches skills the same way. Unknown names are left out.
 */
export function skillInputs(text: string, names: string[], skills: AgentCommand[]) {
  const leading = /^\/(\S+)/.exec(text)?.[1];
  const wanted = [...new Set([...(leading ? [leading] : []), ...names])];
  return wanted.flatMap((name) => {
    const skill = skills.find((s) => s.name === name && s.path);
    return skill ? [{ type: 'skill' as const, name: skill.name, path: skill.path! }] : [];
  });
}

/** One finished skill-load per attached skill, as the work log shows a Claude Skill tool call. */
export function skillEvents(threadId: string, turnId: string, attached: { name: string }[]): AgentEvent[] {
  return attached.flatMap(({ name }) => {
    const call = { threadId, type: 'tool' as const, id: `skill:${turnId}:${name}`, text: `Skill ${name}`, skill: name };
    return [{ ...call, phase: 'start' as const }, { ...call, phase: 'end' as const }];
  });
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
const AGENT_END = { completed: 'done', errored: 'failed', interrupted: 'stopped', shutdown: 'stopped' } as const;
const OUTPUT_MAX = 4000;

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
      const output = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput.slice(-OUTPUT_MAX) : undefined;
      // `command` is the shell wrapper (`/bin/zsh -lc '…'`); a single `commandActions` entry is what the agent actually typed.
      const actions = Array.isArray(item.commandActions) ? item.commandActions : [];
      const typed = actions.length === 1 ? obj(actions[0])?.command : undefined;
      const text = typeof typed === 'string' ? typed : item.command;
      return [{ threadId, type: 'tool', id, phase, text, ...(phase === 'end' && exitCode !== undefined && { exitCode }), ...(phase === 'end' && output !== undefined && { output }) }];
    }
    case 'fileChange': {
      const files = Array.isArray(item.changes) ? item.changes.flatMap((c) => (typeof obj(c)?.path === 'string' ? [relative(s.cwd, obj(c)!.path as string)] : [])) : [];
      if (phase === 'start') s.changes.set(id, files);
      else s.changes.delete(id);
      return [{ threadId, type: 'tool', id, phase, text: `Edit ${files.join(', ') || 'files'}`, ...(phase === 'end' && item.status === 'completed' && { files }) }];
    }
    case 'mcpToolCall':
      return typeof item.server === 'string' && typeof item.tool === 'string' ? [{ threadId, type: 'tool', id, phase, text: `Mcp ${item.server}: ${item.tool}`, mcp: { server: item.server, tool: item.tool } }] : [];
    case 'webSearch': {
      const { text, links } = webSearch(item);
      return [{ threadId, type: 'tool', id, phase, text, ...(phase === 'end' && links.length > 0 && { links }) }];
    }
    case 'subAgentActivity':
      return phase === 'end' ? subAgentActivity(item, threadId) : [];
    case 'collabAgentToolCall':
      return phase === 'end' ? collabCall(item, threadId) : [];
  }
  return [];
}

/**
 * A spawned agent's lifecycle on its parent (0.155.1, multi-agent v2): `started` when spawned, `completed` / `interrupted`
 * when it settles. Its own work arrives on its own thread id (`childEvents`). Read on `item/completed` only: the item
 * fires started and completed with the same kind.
 */
function subAgentActivity(item: Record<string, unknown>, threadId: string): AgentEvent[] {
  if (typeof item.agentThreadId !== 'string') return [];
  const id = item.agentThreadId;
  if (item.kind === 'started') return [{ threadId, type: 'subagent', id, phase: 'start', toolId: String(item.id), name: agentName(item.agentPath), isBackground: true }];
  if (item.kind === 'completed') return [{ threadId, type: 'subagent', id, phase: 'end', status: 'done' }];
  if (item.kind === 'interrupted') return [{ threadId, type: 'subagent', id, phase: 'end', status: 'stopped' }];
  return [];
}

/** The v1 collab tools: `spawnAgent` names the new agents in `receiverThreadIds`; any call may carry their last known states. */
function collabCall(item: Record<string, unknown>, threadId: string): AgentEvent[] {
  const receivers = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.filter((r) => typeof r === 'string') : [];
  const prompt = typeof item.prompt === 'string' ? item.prompt : undefined;
  const model = typeof item.model === 'string' ? item.model : undefined;
  const spawned: AgentEvent[] =
    item.tool === 'spawnAgent' && item.status === 'completed'
      ? receivers.map((id) => ({ threadId, type: 'subagent', id, phase: 'start', toolId: String(item.id), name: prompt ? firstWords(prompt) : 'Agent', ...(prompt && { prompt }), ...(model && { model }), isBackground: true }))
      : [];
  const states = Object.entries(obj(item.agentsStates) ?? {}).flatMap(([id, state]): AgentEvent[] => {
    const status = AGENT_END[obj(state)?.status as keyof typeof AGENT_END];
    const message = obj(state)?.message;
    return status ? [{ threadId, type: 'subagent', id, phase: 'end', status, ...(typeof message === 'string' && message && { result: message }) }] : [];
  });
  return [...spawned, ...states];
}

/** What a spawned agent's own thread reports, folded into its parent as that subagent's progress. `s` is the child's own state (its token totals). */
export function childEvents(method: string, params: unknown, s: ThreadState, subagentId: string): AgentEvent[] {
  const p = obj(params);
  if (!p) return [];
  const progress = (fields: Omit<AgentSubagentEvent, 'threadId' | 'type' | 'id' | 'phase'>): AgentSubagentEvent => ({ threadId: s.threadId, type: 'subagent', id: subagentId, phase: 'progress', ...fields });
  if (method === 'thread/tokenUsage/updated') {
    const total = obj(obj(p.tokenUsage)?.total)?.totalTokens;
    // The parent's own usage leaves its children out, so their spend is added to the thread here, without touching its context meter.
    const spend = mapUsage(obj(p.tokenUsage), s).flatMap((e): AgentEvent[] => (e.type === 'usage' ? [{ threadId: e.threadId, type: 'usage', inputTokens: e.inputTokens, outputTokens: e.outputTokens }] : []));
    return [...spend, ...(typeof total === 'number' ? [progress({ tokens: total })] : [])];
  }
  if (method === 'turn/completed') {
    const turn = obj(p.turn);
    const status = TURN_STATUS[turn?.status as keyof typeof TURN_STATUS];
    const error = obj(turn?.error)?.message;
    if (!status) return [];
    return [{ threadId: s.threadId, type: 'subagent', id: subagentId, phase: 'end', status: status === 'interrupted' ? 'stopped' : status, ...(typeof error === 'string' && { error: apiMessage(error) }) }];
  }
  if (method !== 'item/started' && method !== 'item/completed') return [];
  const item = obj(p.item);
  if (item?.type === 'agentMessage') return method === 'item/completed' && typeof item.text === 'string' && item.text ? [progress({ message: item.text })] : [];
  return mapItem(item, method === 'item/started' ? 'start' : 'end', s).flatMap((e) => (e.type === 'tool' ? [progress({ step: { id: e.id, phase: e.phase, text: e.text, ...(e.files && { files: e.files }), ...(e.exitCode !== undefined && { exitCode: e.exitCode }), ...(e.output !== undefined && { output: e.output }) } })] : []));
}

/** `/root/echo_hi` → "echo hi". */
function agentName(agentPath: unknown) {
  const last = typeof agentPath === 'string' ? agentPath.split('/').filter(Boolean).at(-1) : undefined;
  return last ? last.replaceAll('_', ' ') : 'Agent';
}

const firstWords = (text: string) => text.split(/\s+/).slice(0, 6).join(' ');

/**
 * A `webSearch` item (codex 0.155.1 `WebSearchItem`): `action` says whether it searched or opened a page, and the query
 * often arrives only on completion. `results` is opaque JSON the protocol passes through from standalone search.
 */
export function webSearch(item: Record<string, unknown>): { text: string; links: WebLink[] } {
  const action = obj(item.action);
  const url = typeof action?.url === 'string' ? action.url : undefined;
  if (url && (action?.type === 'openPage' || action?.type === 'findInPage')) return { text: `Fetch ${url}`, links: [{ url }] };
  const queries = Array.isArray(action?.queries) ? action.queries.filter((q) => typeof q === 'string') : [];
  const query = [item.query, action?.query, queries.join(', ')].find((q) => typeof q === 'string' && q) as string | undefined;
  // The protocol types `results` as opaque JSON; a live run (0.155.1) sent `{ type: 'text_result', url, title, domain, snippet, ref_id }`.
  const links = (Array.isArray(item.results) ? item.results : []).flatMap((r) => {
    const hit = obj(r);
    return typeof hit?.url === 'string' ? [{ url: hit.url, ...(typeof hit.title === 'string' && hit.title && { title: hit.title }) }] : [];
  });
  return { text: query ? `Search ${query}` : 'Search the web', links };
}

function mapUsage(usage: Record<string, unknown> | undefined, s: ThreadState): AgentEvent[] {
  const total = obj(usage?.total);
  const last = obj(usage?.last);
  if (typeof total?.inputTokens !== 'number' || typeof total.outputTokens !== 'number') return [];
  const now = { input: total.inputTokens, output: total.outputTokens, cached: num(total.cachedInputTokens) };
  // After a resume, count only the request this update reports.
  const before = s.total ?? { input: now.input - num(last?.inputTokens), output: now.output - num(last?.outputTokens), cached: now.cached - num(last?.cachedInputTokens) };
  s.total = now;
  const inputTokens = Math.max(0, now.input - before.input);
  const outputTokens = Math.max(0, now.output - before.output);
  const cachedTokens = Math.max(0, now.cached - before.cached);
  const contextMax = typeof usage?.modelContextWindow === 'number' ? usage.modelContextWindow : undefined;
  const contextUsed = typeof last?.totalTokens === 'number' ? last.totalTokens : undefined;
  // Codex reports tokens, never spend; the summary shows tokens for it rather than a price Mochi would have to guess.
  return [{ threadId: s.threadId, type: 'usage', inputTokens, outputTokens, cachedTokens, ...(contextUsed !== undefined && { contextUsed }), ...(contextMax !== undefined && { contextMax }) }];
}

/** Upstream API errors arrive as their raw JSON body; show the message inside. */
export function apiMessage(message: string) {
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

/** One `model/list` page (app-server 0.155.1 `ModelListResponse`) as the picker lists it; hidden models stay out. */
export function codexModels(result: unknown): AgentModel[] {
  const data = (result as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((m: Record<string, unknown>) => {
    if (typeof m?.model !== 'string' || m.hidden === true) return [];
    const efforts = Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts.flatMap((e: { reasoningEffort?: unknown }) => (typeof e?.reasoningEffort === 'string' ? [e.reasoningEffort] : [])) : [];
    const defaultEffort = typeof m.defaultReasoningEffort === 'string' ? m.defaultReasoningEffort : undefined;
    return [{ id: m.model, name: typeof m.displayName === 'string' ? m.displayName : m.model, description: typeof m.description === 'string' ? m.description : '', efforts, ...(defaultEffort && { defaultEffort }), isDefault: m.isDefault === true }];
  });
}
