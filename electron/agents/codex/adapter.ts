import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import type { AgentDecision, AgentEvent, AgentRunOptions } from '../../../src/host/types/agent.ts';
import { accountEnv, accountFor as defaultAccountFor, findCodex as defaultFindCodex, type AccountFor, type CodexAccount, type FindCodex } from './account.ts';
import { codexThreadId, infoFromLists, infoFromStart, mapNotification, mapRequest, requestKey, threadState, updateLimits, type AccountLimits, type ThreadState } from './map.ts';
import { RpcClient, type RpcId } from './rpc.ts';

interface Live {
  codexId: string;
  /** Fixed at start: a thread never moves to another Codex account, its rollout lives in that account's config dir. */
  server: CodexServer;
  state: ThreadState;
  /** Server generation the thread was opened on; after a crash it is resumed on the new server before the next turn. */
  gen: number;
  turnId?: string;
  options: AgentRunOptions;
}

interface Pending {
  id: RpcId;
  server: CodexServer;
  method: string;
  threadId: string;
  questionIds: string[];
}

// GAP: the composer's permission modes are Claude's names; these are the closest Codex policies. No mode keeps the user's own Codex config.
const POLICIES: Record<string, { approvalPolicy: string; sandbox: string }> = {
  default: { approvalPolicy: 'untrusted', sandbox: 'workspace-write' },
  acceptEdits: { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
  plan: { approvalPolicy: 'on-request', sandbox: 'read-only' },
  bypassPermissions: { approvalPolicy: 'never', sandbox: 'danger-full-access' },
};
/** Codex's plan tool is off unless configured; Harness maps its plans onto goal steps, so its threads always get it. Verified against 0.155.1: without it `turn/plan/updated` never fires. */
const PLAN_TOOL = { 'tools.update_plan.enabled': true };
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
  private emit: (event: AgentEvent) => void;
  private accountFor: AccountFor;
  private findCodex: FindCodex;

  constructor(emit: (event: AgentEvent) => void, accountFor: AccountFor = defaultAccountFor, findCodex: FindCodex = defaultFindCodex) {
    this.emit = emit;
    this.accountFor = accountFor;
    this.findCodex = findCodex;
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
      await this.turn(threadId, options.prompt);
    });
  }

  async send(threadId: string, text: string) {
    if (!this.threads.has(threadId)) throw new Error('No live Codex session for this thread; resume it first');
    await this.report(threadId, () => this.turn(threadId, text));
  }

  async interrupt(threadId: string) {
    const live = this.threads.get(threadId);
    const rpc = live?.server.rpc;
    if (!live?.turnId || !rpc || live.gen !== live.server.gen) return;
    await rpc.request('turn/interrupt', { threadId: live.codexId, turnId: live.turnId });
  }

  async resolve(requestId: string, decision: AgentDecision) {
    const pending = this.requests.get(requestId);
    if (!pending) return;
    this.requests.delete(requestId);
    pending.server.rpc?.respond(pending.id, reply(pending, decision));
  }

  async stop(threadId: string) {
    const live = this.threads.get(threadId);
    if (!live) return;
    await this.interrupt(threadId).catch(() => {});
    this.forget(threadId);
    const rpc = live.server.rpc;
    if (rpc && live.gen === live.server.gen) await rpc.request('thread/unsubscribe', { threadId: live.codexId }).catch(() => {});
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
    this.forget(threadId);
    const params = { cwd: options.cwd, model: options.model ?? null, config: PLAN_TOOL, ...POLICIES[options.permissionMode ?? ''] };
    const result = options.resume
      ? await rpc.request('thread/resume', { ...params, threadId: options.resume, excludeTurns: true }, THREAD_TIMEOUT_MS)
      : await rpc.request('thread/start', params, THREAD_TIMEOUT_MS);
    const codexId = (result as { thread?: { id?: unknown } })?.thread?.id;
    if (typeof codexId !== 'string') throw new Error(`codex ${options.resume ? 'thread/resume' : 'thread/start'} returned no thread id`);
    const state = threadState(threadId, options.cwd, { isResumed: !!options.resume, account: server.account.id, limits: server.limits });
    const live: Live = { codexId, server, state, gen: server.gen, options: { ...options, resume: codexId } };
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

  private async turn(threadId: string, text: string) {
    let live = this.threads.get(threadId)!;
    const rpc = await live.server.client();
    if (live.gen !== live.server.gen) {
      await this.open(live.server, rpc, threadId, live.options);
      live = this.threads.get(threadId)!;
    }
    const result = await rpc.request('turn/start', { threadId: live.codexId, input: [{ type: 'text', text, text_elements: [] }], effort: live.options.effort ?? null });
    const turnId = (result as { turn?: { id?: unknown } })?.turn?.id;
    if (typeof turnId === 'string') live.turnId = turnId;
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
    if (method === 'account/rateLimits/updated') return updateLimits(server.limits, params);
    const live = server.byCodex.get(codexThreadId(params) ?? '');
    if (!live) return;
    const turnId = (params as { turn?: { id?: unknown } }).turn?.id;
    if (method === 'turn/started' && typeof turnId === 'string') live.turnId = turnId;
    if (method === 'turn/completed') live.turnId = undefined;
    for (const event of mapNotification(method, params, live.state)) {
      if (event.type === 'resolved' && !this.requests.delete(event.requestId)) continue;
      this.emit(event);
    }
  }

  private request(server: CodexServer, id: RpcId, method: string, params: unknown) {
    const live = server.byCodex.get(codexThreadId(params) ?? '');
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

/** The JSON-RPC result for a server request, from the queue card's answer. */
export function reply(pending: Pick<Pending, 'method' | 'questionIds'>, decision: AgentDecision): unknown {
  if (pending.method === 'item/tool/requestUserInput') {
    const answers = decision.kind === 'answer' ? decision.answers : [];
    return { answers: Object.fromEntries(pending.questionIds.flatMap((id, i) => (answers[i] === undefined ? [] : [[id, { answers: [answers[i]] }]]))) };
  }
  if (decision.kind === 'allow') return { decision: decision.forSession ? 'acceptForSession' : 'accept' };
  if (decision.kind === 'deny') return { decision: decision.interrupt ? 'cancel' : 'decline' };
  return { decision: 'decline' };
}
