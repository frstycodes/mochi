import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import type { AgentDecision, AgentEvent, AgentImage, AgentModel, AgentRunOptions, LimitWindow } from '../../../src/host/types/agent.ts';
import { codexWindows } from '../../../src/usage/limits.ts';
import { accountEnv, accountFor as defaultAccountFor, findCodex as defaultFindCodex, type AccountFor, type CodexAccount, type FindCodex } from './account.ts';
import { apiMessage, childEvents, codexModels, codexThreadId, commandsFromSkills, infoFromLists, infoFromStart, mapNotification, mapRequest, requestKey, skillEvents, skillInputs, threadState, updateLimits, type AccountLimits, type ThreadState } from './map.ts';
import { RpcClient, type RpcId } from './rpc.ts';
import { MOCHI_TIMEOUT_MS } from '../../../src/runtime/toolTable.ts';

interface Live {
  codexId: string;
  /** Fixed at start: a thread never moves to another Codex account, its rollout lives in that account's config dir. */
  server: CodexServer;
  state: ThreadState;
  /** Server generation the thread was opened on; after a crash it is resumed on the new server before the next turn. */
  gen: number;
  turnId?: string;
  /** Turns this thread started on this Codex thread, oldest first, for `rewindPoint`. */
  turns: { id: string; text: string }[];
  options: AgentRunOptions;
}

/** A Codex agent spawned by a thread's agent: its own Codex thread, reported as that thread's subagent. */
interface Child {
  parent: Live;
  /** The child's own token totals; `threadId` is the parent's harness thread. */
  state: ThreadState;
  turnId?: string;
}

interface Pending {
  id: RpcId;
  server: CodexServer;
  method: string;
  threadId: string;
  questionIds: string[];
}

// GAP: the composer's permission modes are Claude's names; these are the closest Codex policies. No mode keeps the user's own Codex config.
export const POLICIES: Record<string, { approvalPolicy: string; sandbox: string; approvalsReviewer?: string }> = {
  /** Not `untrusted`: 0.155.1 asked before every command, `cat` and `git status` too, since each arrives wrapped in `zsh -lc`. In the read-only sandbox reads run unasked and anything that writes or needs the network escalates to the user. */
  default: { approvalPolicy: 'on-request', sandbox: 'read-only' },
  /** Sandboxed work runs unasked; escalations (network, writes outside the workspace) go to Codex's own reviewer (`guardian_approval`, stable in 0.155.1), not the user. */
  auto: { approvalPolicy: 'on-request', sandbox: 'workspace-write', approvalsReviewer: 'auto_review' },
  acceptEdits: { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
  plan: { approvalPolicy: 'on-request', sandbox: 'read-only' },
  bypassPermissions: { approvalPolicy: 'never', sandbox: 'danger-full-access' },
  /** Second opinions: nothing can write, and nothing asks; a command that needs more simply fails. */
  review: { approvalPolicy: 'never', sandbox: 'read-only' },
};
/** Codex's plan tool is off unless configured; Harness maps its plans onto goal steps, so its threads always get it. Verified against 0.155.1: without it `turn/plan/updated` never fires. */
const PLAN_TOOL = { 'tools.update_plan.enabled': true };
/**
 * Side chat's thread: nothing saved, nothing writable, nothing to approve, and the tool features the installed codex lists
 * (`codex features list`, 0.155.1) switched off, so it only answers from the context it is given.
 */
const ASK_THREAD = {
  ephemeral: true,
  sandbox: 'read-only',
  approvalPolicy: 'never',
  config: Object.fromEntries(['shell_tool', 'unified_exec', 'apps', 'plugins', 'multi_agent', 'browser_use', 'computer_use', 'image_generation', 'view_image', 'goals'].map((f) => [`features.${f}`, false])),
};
/**
 * Mirrors Claude's `AUTO_ALLOWED` (`electron/mcp/server.ts`): Mochi asks with its own card, so Codex never prompts, and a
 * call may wait on that card as long as main does. `tool_timeout_sec` read in 0.155.1's binary; the approval key was verified against its config schema.
 */
const MOCHI_APPROVALS = { 'mcp_servers.mochi.default_tools_approval_mode': 'approve', 'mcp_servers.mochi.tool_timeout_sec': MOCHI_TIMEOUT_MS / 1000 };
const NOT_FOUND = 'Codex is not installed or not on your PATH. Install it (`npm i -g @openai/codex`) or set its path in Settings.';
const THREAD_TIMEOUT_MS = 120_000;
const CRASH_WINDOW_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * One `codex app-server` child per Codex account in use, each driving the user's own install with that account's own login.
 * Harness never calls `account/login/*` and never touches credentials; logged out means telling the user to run `codex login`.
 */
export class CodexAdapter {
  private servers = new Map<string, CodexServer>();
  private threads = new Map<string, Live>();
  private requests = new Map<string, Pending>();
  /** Review threads answer every turn in this JSON schema. */
  private schemas = new Map<string, unknown>();
  private emit: (event: AgentEvent) => void;
  private accountFor: AccountFor;
  private findCodex: FindCodex;
  private toolsUrl?: (threadId: string) => Promise<string>;
  /** Each account's plan windows as `account/rateLimits/updated` reports them (sparse). */
  onLimits?: (accountId: string, windows: LimitWindow[]) => void;

  /** `toolsUrl` is the thread's Mochi tools server (`electron/mcp`); without it threads get no Mochi tools. */
  constructor(emit: (event: AgentEvent) => void, accountFor: AccountFor = defaultAccountFor, findCodex: FindCodex = defaultFindCodex, toolsUrl?: (threadId: string) => Promise<string>) {
    this.emit = emit;
    this.accountFor = accountFor;
    this.findCodex = findCodex;
    this.toolsUrl = toolsUrl;
  }

  owns(threadId: string) {
    return this.threads.has(threadId);
  }

  ownsRequest(requestId: string) {
    return requestId.startsWith('codex:');
  }

  /** Starts a thread on its profile's account, or resumes the one in `options.resume`, and sends the first prompt. Failures arrive as a failed turn, not a rejection. */
  async start(threadId: string, options: AgentRunOptions) {
    await this.report(threadId, async () => {
      const server = this.threads.get(threadId)?.server ?? this.server(await this.accountFor(options.spaceId, 'codex'));
      const rpc = await server.client();
      await server.requireLogin(rpc);
      await this.open(server, rpc, threadId, options);
      await this.turn(threadId, options.prompt, options.images, options.skills);
    });
  }

  /** A read-only review on its own Codex thread; its events go out under `threadId` like any thread's. Stop it when done. */
  async review(threadId: string, options: AgentRunOptions, outputSchema: unknown) {
    this.schemas.set(threadId, outputSchema);
    await this.start(threadId, { ...options, permissionMode: 'review' });
  }

  /** `speed`: '' standard, a service tier id, unset keeps the thread's; it holds for this turn and the ones after. */
  async send(threadId: string, text: string, images?: AgentImage[], skills?: string[], speed?: string) {
    const live = this.threads.get(threadId);
    if (!live) throw new Error('No live Codex session for this thread; resume it first');
    if (speed !== undefined) live.options = { ...live.options, speed: speed || undefined };
    await this.report(threadId, () => this.turn(threadId, text, images, skills));
  }

  /** What a live thread runs on, with the speed its latest message set. */
  runOptions(threadId: string) {
    return this.threads.get(threadId)?.options;
  }

  /** The turn before the latest one started with this text, for `forkAt`; null when unknown or it was the first. */
  rewindPoint(threadId: string, text: string) {
    const turns = this.threads.get(threadId)?.turns ?? [];
    const index = turns.findLastIndex((t) => t.text.includes(text));
    return index > 0 ? turns[index - 1].id : null;
  }

  async interrupt(threadId: string) {
    const live = this.threads.get(threadId);
    const rpc = live?.server.rpc;
    if (!live?.turnId || !rpc || live.gen !== live.server.gen) return;
    await rpc.request('turn/interrupt', { threadId: live.codexId, turnId: live.turnId });
  }

  /** Interrupts a spawned agent's turn; it then reports `stopped`. */
  async stopSubagent(threadId: string, subagentId: string) {
    const live = this.threads.get(threadId);
    const child = live?.server.children.get(subagentId);
    const rpc = live?.server.rpc;
    if (!child || child.parent !== live || !child.turnId || !rpc) throw new Error('That agent is not running');
    await rpc.request('turn/interrupt', { threadId: subagentId, turnId: child.turnId });
  }

  async resolve(requestId: string, decision: AgentDecision) {
    const pending = this.requests.get(requestId);
    if (!pending) return;
    this.requests.delete(requestId);
    pending.server.rpc?.respond(pending.id, reply(pending, decision));
  }

  async stop(threadId: string) {
    this.schemas.delete(threadId);
    const live = this.threads.get(threadId);
    if (!live) return;
    await this.interrupt(threadId).catch(() => {});
    this.forget(threadId);
    const rpc = live.server.rpc;
    if (rpc && live.gen === live.server.gen) await rpc.request('thread/unsubscribe', { threadId: live.codexId }).catch(() => {});
  }

  /**
   * Side chat on the profile's Codex account: an ephemeral read-only thread on the account's app-server, its answer
   * streamed as text deltas. Never touches a Mochi thread. Throws a message the side chat can show.
   */
  async *ask(spaceId: string, instructions: string, prompt: string, model: string | undefined, abort: AbortController): AsyncGenerator<string> {
    const server = this.server(await this.accountFor(spaceId, 'codex'));
    const rpc = await server.client();
    await server.requireLogin(rpc);
    const result = await rpc.request('thread/start', { ...ASK_THREAD, cwd: os.tmpdir(), model: model ?? null, developerInstructions: instructions }, THREAD_TIMEOUT_MS);
    const codexId = (result as { thread?: { id?: unknown } })?.thread?.id;
    if (typeof codexId !== 'string') throw new Error('codex thread/start returned no thread id');
    const answer = new Inbox();
    server.asks.set(codexId, answer);
    let turnId: string | undefined;
    const stop = () => turnId && void rpc.request('turn/interrupt', { threadId: codexId, turnId }).catch(() => {});
    abort.signal.addEventListener('abort', stop, { once: true });
    try {
      const turn = await rpc.request('turn/start', { threadId: codexId, input: [{ type: 'text', text: prompt, text_elements: [] }] });
      turnId = (turn as { turn?: { id?: unknown } })?.turn?.id as string | undefined;
      yield* answer.drain(abort.signal);
    } finally {
      abort.signal.removeEventListener('abort', stop);
      server.asks.delete(codexId);
      void rpc.request('thread/unsubscribe', { threadId: codexId }).catch(() => {});
    }
  }

  /** The profile's account's full `account/rateLimits/read` snapshot. Throws when logged out. */
  async readLimits(spaceId: string) {
    const server = this.server(await this.accountFor(spaceId, 'codex'));
    const rpc = await server.client();
    await server.requireLogin(rpc);
    const result = (await rpc.request('account/rateLimits/read', {})) as { rateLimits?: Parameters<typeof codexWindows>[0] } | null;
    return { accountId: server.account.id, windows: codexWindows(result?.rateLimits) };
  }

  /** Every page of the profile's account's `model/list`. Throws when logged out. */
  async models(spaceId: string): Promise<AgentModel[]> {
    const server = this.server(await this.accountFor(spaceId, 'codex'));
    const rpc = await server.client();
    await server.requireLogin(rpc);
    const models: AgentModel[] = [];
    let cursor: string | null = null;
    do {
      const page = (await rpc.request('model/list', { cursor })) as { nextCursor?: string | null };
      models.push(...codexModels(page));
      cursor = page?.nextCursor ?? null;
    } while (cursor);
    return models;
  }

  dispose() {
    for (const server of this.servers.values()) server.dispose();
  }

  private server(account: CodexAccount) {
    let server = this.servers.get(account.id);
    if (server) return server;
    server = new CodexServer(account, {
      notification: (method, params) => this.notification(server!, method, params),
      request: (id, method, params) => this.request(server!, id, method, params),
      exited: (message) => this.exited(server!, message),
      findCodex: this.findCodex,
    });
    this.servers.set(account.id, server);
    return server;
  }

  private async open(server: CodexServer, rpc: RpcClient, threadId: string, options: AgentRunOptions) {
    // A reopen after a server crash keeps the turns it knew; a fork starts a new Codex thread whose turns it doesn't.
    const prior = this.threads.get(threadId);
    const turns = prior && prior.codexId === options.resume ? prior.turns : [];
    this.forget(threadId);
    const tools = this.toolsUrl && { ...MOCHI_APPROVALS, 'mcp_servers.mochi.url': await this.toolsUrl(threadId) };
    const params = { cwd: options.cwd, model: options.model ?? null, serviceTier: options.speed ?? null, config: { ...PLAN_TOOL, ...tools }, ...POLICIES[options.permissionMode ?? ''] };
    const result = options.resume && options.forkAt
      ? await rpc.request('thread/fork', { ...params, threadId: options.resume, lastTurnId: options.forkAt, excludeTurns: true }, THREAD_TIMEOUT_MS)
      : options.resume
        ? await rpc.request('thread/resume', { ...params, threadId: options.resume, excludeTurns: true }, THREAD_TIMEOUT_MS)
        : await rpc.request('thread/start', params, THREAD_TIMEOUT_MS);
    const codexId = (result as { thread?: { id?: unknown } })?.thread?.id;
    if (typeof codexId !== 'string') throw new Error(`codex ${options.resume ? 'thread/resume' : 'thread/start'} returned no thread id`);
    const state = threadState(threadId, options.cwd, { isResumed: !!options.resume, account: server.account.id, limits: server.limits });
    const live: Live = { codexId, server, state, gen: server.gen, turns, options: { ...options, resume: codexId, forkAt: undefined } };
    this.threads.set(threadId, live);
    server.byCodex.set(codexId, live);
    this.emit({ threadId, type: 'session', provider: 'codex', sessionId: codexId });
    this.emit({ threadId, type: 'info', info: infoFromStart(result) });
    void this.discover(rpc, threadId, codexId, options.cwd);
  }

  /** Lists what the thread can reach. Best effort: the panel shows what came back, a failed call just leaves its list out. */
  private async discover(rpc: RpcClient, threadId: string, codexId: string, cwd: string) {
    const [mcp, skills, plugins] = await Promise.all([
      rpc.request('mcpServerStatus/list', { threadId: codexId, detail: 'toolsAndAuthOnly' }).catch(() => null),
      rpc.request('skills/list', { cwds: [cwd] }).catch(() => null),
      rpc.request('plugin/installed', { cwds: [cwd] }).catch(() => null),
    ]);
    if (this.threads.get(threadId)?.codexId === codexId) this.emit({ threadId, type: 'info', info: infoFromLists(mcp, skills, plugins) });
  }

  private async turn(threadId: string, text: string, images: AgentImage[] = [], skills: string[] = []) {
    let live = this.threads.get(threadId)!;
    const rpc = await live.server.client();
    if (live.gen !== live.server.gen) {
      await this.open(live.server, rpc, threadId, live.options);
      live = this.threads.get(threadId)!;
    }
    const listed = text.startsWith('/') || skills.length ? commandsFromSkills(await rpc.request('skills/list', { cwds: [live.options.cwd] }).catch(() => null)) : [];
    const attached = skillInputs(text, skills, listed);
    const input = [...images.map((i) => ({ type: 'image', url: `data:${i.mediaType};base64,${i.data}` })), { type: 'text', text, text_elements: [] }, ...attached];
    // Mid-turn, the message steers the running turn (schema `TurnSteerParams`, 0.155.1) instead of waiting for a new one. Steer takes no
    // `serviceTier`, so a speed change made while steering applies from the next turn/start.
    if (live.turnId) return void (await rpc.request('turn/steer', { threadId: live.codexId, expectedTurnId: live.turnId, input }));
    const result = await rpc.request('turn/start', { threadId: live.codexId, input, effort: live.options.effort ?? null, serviceTier: live.options.speed ?? null, outputSchema: this.schemas.get(threadId) ?? null });
    const turnId = (result as { turn?: { id?: unknown } })?.turn?.id;
    if (typeof turnId === 'string') live.turnId = turnId;
    if (typeof turnId === 'string') live.turns.push({ id: turnId, text });
    // Codex reports no skill load of its own: an attached skill is loaded with the turn.
    for (const event of skillEvents(threadId, typeof turnId === 'string' ? turnId : String(Date.now()), attached)) this.emit(event);
  }

  private async report(threadId: string, run: () => Promise<void>) {
    try {
      await run();
    } catch (error) {
      this.emit({ threadId, type: 'turn-end', status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Live turns on that account fail and its open cards go away; the next call restarts its server after a backoff. */
  private exited(server: CodexServer, message: string) {
    for (const ask of server.asks.values()) ask.fail(message);
    for (const [requestId, p] of this.requests) {
      if (p.server !== server) continue;
      this.requests.delete(requestId);
      this.emit({ threadId: p.threadId, type: 'resolved', requestId });
    }
    for (const [threadId, live] of this.threads) {
      if (live.server !== server || !live.turnId) continue;
      live.turnId = undefined;
      this.emit({ threadId, type: 'turn-end', status: 'failed', error: message });
    }
  }

  private notification(server: CodexServer, method: string, params: unknown) {
    if (method === 'account/rateLimits/updated') {
      this.onLimits?.(server.account.id, codexWindows((params as { rateLimits?: Parameters<typeof codexWindows>[0] }).rateLimits));
      const window = updateLimits(server.limits, params);
      // Account-wide, so every thread mid-turn on this account hears it; the store logs each window once.
      if (window) for (const live of server.byCodex.values()) if (live.turnId) this.emit({ threadId: live.state.threadId, type: 'limit-warning', window });
      return;
    }
    const ask = server.asks.get(codexThreadId(params) ?? '');
    if (ask) return ask.notify(method, params);
    const turnId = (params as { turn?: { id?: unknown } }).turn?.id;
    const child = server.children.get(codexThreadId(params) ?? '');
    if (child) {
      if (method === 'turn/started' && typeof turnId === 'string') child.turnId = turnId;
      if (method === 'turn/completed') child.turnId = undefined;
      return childEvents(method, params, child.state, codexThreadId(params)!).forEach(this.emit);
    }
    const live = server.byCodex.get(codexThreadId(params) ?? '');
    if (!live) return;
    if (method === 'turn/started' && typeof turnId === 'string') live.turnId = turnId;
    if (method === 'turn/completed') live.turnId = undefined;
    for (const event of mapNotification(method, params, live.state)) {
      if (event.type === 'resolved' && !this.requests.delete(event.requestId)) continue;
      // Verified on 0.155.1: a spawned agent's notifications arrive on this connection under its own thread id.
      if (event.type === 'subagent' && event.phase === 'start' && !server.children.has(event.id)) server.children.set(event.id, { parent: live, state: threadState(live.state.threadId, live.state.cwd, { account: server.account.id, limits: server.limits }) });
      this.emit(event);
    }
  }

  private request(server: CodexServer, id: RpcId, method: string, params: unknown) {
    // A spawned agent's approvals are its parent thread's to answer.
    const live = server.byCodex.get(codexThreadId(params) ?? '') ?? server.children.get(codexThreadId(params) ?? '')?.parent;
    const requestId = requestKey(server.account.id, id);
    const event = live && mapRequest(method, params, requestId, live.state);
    if (!event) return server.rpc?.respondError(id, -32601, `Harness does not handle ${method}`);
    const questions = (params as { questions?: { id?: unknown }[] }).questions;
    const questionIds = Array.isArray(questions) ? questions.map((q) => String(q?.id)) : [];
    this.requests.set(requestId, { id, server, method, threadId: live.state.threadId, questionIds });
    this.emit(event);
  }

  private forget(threadId: string) {
    const live = this.threads.get(threadId);
    if (!live) return;
    this.threads.delete(threadId);
    live.server.byCodex.delete(live.codexId);
    for (const [id, child] of live.server.children) if (child.parent === live) live.server.children.delete(id);
    for (const [requestId, p] of this.requests) if (p.threadId === threadId) this.requests.delete(requestId);
  }
}

interface ServerHooks {
  notification(method: string, params: unknown): void;
  request(id: RpcId, method: string, params: unknown): void;
  exited(message: string): void;
  findCodex: FindCodex;
}

/** One account's `codex app-server` child, started lazily with that account's `CODEX_HOME`. */
class CodexServer {
  account: CodexAccount;
  rpc?: RpcClient;
  gen = 0;
  byCodex = new Map<string, Live>();
  /** Spawned agents by their Codex thread id. */
  children = new Map<string, Child>();
  asks = new Map<string, Inbox>();
  limits: AccountLimits = {};
  private hooks: ServerHooks;
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<RpcClient>;
  private crashes: number[] = [];
  private stderr = '';

  constructor(account: CodexAccount, hooks: ServerHooks) {
    this.account = account;
    this.hooks = hooks;
  }

  client(): Promise<RpcClient> {
    this.ready ??= this.boot().catch((error) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  async requireLogin(rpc: RpcClient) {
    const result = (await rpc.request('account/read', {})) as { account?: unknown; requiresOpenaiAuth?: unknown } | null;
    if (result?.account || result?.requiresOpenaiAuth === false) return;
    const login = this.account.configDir ? `CODEX_HOME=${this.account.configDir} codex login` : 'codex login';
    throw new Error(`Codex is not logged in${this.account.configDir ? ' for this profile' : ''}. Run \`${login}\` in a terminal, then try again.`);
  }

  dispose() {
    this.child?.kill();
  }

  private async boot(): Promise<RpcClient> {
    const now = Date.now();
    this.crashes = this.crashes.filter((at) => now - at < CRASH_WINDOW_MS);
    if (this.crashes.length) await new Promise((r) => setTimeout(r, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.crashes.length - 1))));

    const install = await this.hooks.findCodex();
    if (!install) throw new Error(NOT_FOUND);
    const child = spawn(install.path, ['app-server'], { cwd: os.homedir(), env: accountEnv(this.account, install.env), stdio: ['pipe', 'pipe', 'pipe'] });
    const gen = ++this.gen;
    this.child = child;
    this.stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (this.stderr = (this.stderr + chunk).slice(-2000)));
    const rpc = new RpcClient(child.stdout, child.stdin, {
      onNotification: this.hooks.notification,
      onRequest: this.hooks.request,
      onInvalid: (reason, line) => console.warn(`[codex ${this.account.id}] ignored message (${reason}): ${line}`),
    });
    this.rpc = rpc;
    child.on('error', (error) => rpc.close(`codex app-server failed: ${error.message}`));
    child.on('exit', (code, signal) => this.exited(gen, code ?? signal));

    await rpc.request('initialize', { clientInfo: { name: 'harness', title: 'Harness', version: '0.0.0' }, capabilities: null });
    rpc.notify('initialized');
    return rpc;
  }

  private exited(gen: number, reason: number | string | null) {
    if (gen !== this.gen) return;
    const message = `Codex app-server exited (${reason})${this.stderr.trim() ? `: ${this.stderr.trim().split('\n').at(-1)}` : ''}`;
    this.crashes.push(Date.now());
    this.rpc?.close(message);
    this.rpc = undefined;
    this.child = undefined;
    this.ready = undefined;
    this.gen++;
    this.hooks.exited(message);
  }
}

/** One side chat answer: its thread's notifications in, text chunks out, ending at `turn/completed`. */
class Inbox {
  private chunks: string[] = [];
  private streamed = new Set<string>();
  private end?: { error?: string };
  private wake = () => {};

  notify(method: string, params: unknown) {
    const p = params as { itemId?: unknown; delta?: unknown; item?: { type?: unknown; id?: unknown; text?: unknown }; turn?: { status?: unknown; error?: { message?: unknown } } };
    if (method === 'item/agentMessage/delta' && typeof p.delta === 'string') {
      this.streamed.add(String(p.itemId));
      this.chunks.push(p.delta);
    }
    // A message that never streamed arrives whole.
    if (method === 'item/completed' && p.item?.type === 'agentMessage' && typeof p.item.text === 'string' && !this.streamed.has(String(p.item.id))) this.chunks.push(p.item.text);
    if (method === 'turn/completed') {
      const error = p.turn?.error?.message;
      this.end = p.turn?.status === 'failed' ? { error: typeof error === 'string' ? apiMessage(error) : 'Codex stopped without an answer' } : {};
    }
    this.wake();
  }

  fail(error: string) {
    this.end = { error };
    this.wake();
  }

  async *drain(signal: AbortSignal) {
    const aborted = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    while (!signal.aborted) {
      if (this.chunks.length) yield this.chunks.splice(0).join('');
      else if (this.end?.error) throw new Error(this.end.error);
      else if (this.end) return;
      else await Promise.race([new Promise<void>((resolve) => (this.wake = resolve)), aborted]);
    }
  }
}

/** The JSON-RPC result for a server request, from the queue card's answer. */
export function reply(pending: Pick<Pending, 'method' | 'questionIds'>, decision: AgentDecision): unknown {
  if (pending.method === 'item/tool/requestUserInput') {
    const answers = decision.kind === 'answer' ? decision.answers : [];
    return { answers: Object.fromEntries(pending.questionIds.flatMap((id, i) => (answers[i]?.length ? [[id, { answers: answers[i] }]] : []))) };
  }
  if (pending.method === 'mcpServer/elicitation/request') return decision.kind === 'allow' ? { action: 'accept', content: {}, _meta: null } : { action: 'decline', content: null, _meta: null };
  if (decision.kind === 'allow') return { decision: decision.forSession ? 'acceptForSession' : 'accept' };
  if (decision.kind === 'deny') return { decision: decision.interrupt ? 'cancel' : 'decline' };
  return { decision: 'decline' };
}
