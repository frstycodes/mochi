import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import type { AgentDecision, AgentEvent, AgentStartOptions } from '../../../src/host/types/agent.ts';
import { findCodex } from './find.ts';
import { codexThreadId, mapNotification, mapRequest, requestKey, threadState, type ThreadState } from './map.ts';
import { RpcClient, type RpcId } from './rpc.ts';

interface Live {
  codexId: string;
  state: ThreadState;
  /** Server generation the thread was opened on; after a crash it is resumed on the new server before the next turn. */
  gen: number;
  turnId?: string;
  options: AgentStartOptions;
}

interface Pending {
  id: RpcId;
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
const NOT_LOGGED_IN = 'Codex is not logged in. Run `codex login` in a terminal, then try again.';
const NOT_FOUND = 'Codex is not installed or not on your PATH. Install it (`npm i -g @openai/codex`) or set its path in Settings.';
const THREAD_TIMEOUT_MS = 120_000;
const CRASH_WINDOW_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * One `codex app-server` child for every Codex thread, driving the user's own install and `codex login`.
 * Harness never calls `account/login/*` and never touches credentials; logged out means telling the user to run `codex login`.
 */
export class CodexAdapter {
  private child?: ChildProcessWithoutNullStreams;
  private rpc?: RpcClient;
  private ready?: Promise<RpcClient>;
  private gen = 0;
  private crashes: number[] = [];
  private stderr = '';
  private threads = new Map<string, Live>();
  private byCodex = new Map<string, Live>();
  private requests = new Map<string, Pending>();
  private emit: (event: AgentEvent) => void;

  constructor(emit: (event: AgentEvent) => void) {
    this.emit = emit;
  }

  owns(threadId: string) {
    return this.threads.has(threadId);
  }

  ownsRequest(requestId: string) {
    return requestId.startsWith('codex:');
  }

  /** Starts a thread, or resumes the one in `options.resume`, and sends the first prompt. Failures arrive as a failed turn, not a rejection. */
  async start(threadId: string, options: AgentStartOptions) {
    await this.report(threadId, async () => {
      const rpc = await this.server();
      await this.requireLogin(rpc);
      await this.open(rpc, threadId, options);
      await this.turn(threadId, options.prompt);
    });
  }

  async send(threadId: string, text: string) {
    if (!this.threads.has(threadId)) throw new Error('No live Codex session for this thread; resume it first');
    await this.report(threadId, () => this.turn(threadId, text));
  }

  async interrupt(threadId: string) {
    const live = this.threads.get(threadId);
    if (!live?.turnId || !this.rpc || live.gen !== this.gen) return;
    await this.rpc.request('turn/interrupt', { threadId: live.codexId, turnId: live.turnId });
  }

  async resolve(requestId: string, decision: AgentDecision) {
    const pending = this.requests.get(requestId);
    if (!pending || !this.rpc) return;
    this.requests.delete(requestId);
    this.rpc.respond(pending.id, reply(pending, decision));
  }

  async stop(threadId: string) {
    const live = this.threads.get(threadId);
    if (!live) return;
    await this.interrupt(threadId).catch(() => {});
    this.forget(threadId);
    if (this.rpc && live.gen === this.gen) await this.rpc.request('thread/unsubscribe', { threadId: live.codexId }).catch(() => {});
  }

  dispose() {
    this.child?.kill();
  }

  private async open(rpc: RpcClient, threadId: string, options: AgentStartOptions) {
    this.forget(threadId);
    const params = { cwd: options.cwd, model: options.model ?? null, config: PLAN_TOOL, ...POLICIES[options.permissionMode ?? ''] };
    const result = options.resume
      ? await rpc.request('thread/resume', { ...params, threadId: options.resume, excludeTurns: true }, THREAD_TIMEOUT_MS)
      : await rpc.request('thread/start', params, THREAD_TIMEOUT_MS);
    const codexId = (result as { thread?: { id?: unknown } })?.thread?.id;
    if (typeof codexId !== 'string') throw new Error(`codex ${options.resume ? 'thread/resume' : 'thread/start'} returned no thread id`);
    const live: Live = { codexId, state: threadState(threadId, options.cwd, !!options.resume), gen: this.gen, options: { ...options, resume: codexId } };
    this.threads.set(threadId, live);
    this.byCodex.set(codexId, live);
    this.emit({ threadId, type: 'session', provider: 'codex', sessionId: codexId });
  }

  private async turn(threadId: string, text: string) {
    let live = this.threads.get(threadId)!;
    const rpc = await this.server();
    if (live.gen !== this.gen) {
      await this.open(rpc, threadId, live.options);
      live = this.threads.get(threadId)!;
    }
    const result = await rpc.request('turn/start', { threadId: live.codexId, input: [{ type: 'text', text, text_elements: [] }], effort: live.options.effort ?? null });
    const turnId = (result as { turn?: { id?: unknown } })?.turn?.id;
    if (typeof turnId === 'string') live.turnId = turnId;
  }

  private async requireLogin(rpc: RpcClient) {
    const result = (await rpc.request('account/read', {})) as { account?: unknown; requiresOpenaiAuth?: unknown } | null;
    if (!result?.account && result?.requiresOpenaiAuth !== false) throw new Error(NOT_LOGGED_IN);
  }

  private async report(threadId: string, run: () => Promise<void>) {
    try {
      await run();
    } catch (error) {
      this.emit({ threadId, type: 'turn-end', status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }

  private server(): Promise<RpcClient> {
    this.ready ??= this.boot().catch((error) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  private async boot(): Promise<RpcClient> {
    const now = Date.now();
    this.crashes = this.crashes.filter((at) => now - at < CRASH_WINDOW_MS);
    if (this.crashes.length) await new Promise((r) => setTimeout(r, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.crashes.length - 1))));

    const install = await findCodex();
    if (!install) throw new Error(NOT_FOUND);
    const child = spawn(install.path, ['app-server'], { cwd: os.homedir(), env: install.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const gen = ++this.gen;
    this.child = child;
    this.stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (this.stderr = (this.stderr + chunk).slice(-2000)));
    const rpc = new RpcClient(child.stdout, child.stdin, {
      onNotification: (method, params) => this.notification(method, params),
      onRequest: (id, method, params) => this.request(id, method, params),
      onInvalid: (reason, line) => console.warn(`[codex] ignored message (${reason}): ${line}`),
    });
    this.rpc = rpc;
    child.on('error', (error) => rpc.close(`codex app-server failed: ${error.message}`));
    child.on('exit', (code, signal) => this.exited(gen, code ?? signal));

    await rpc.request('initialize', { clientInfo: { name: 'harness', title: 'Harness', version: '0.0.0' }, capabilities: null });
    rpc.notify('initialized');
    return rpc;
  }

  /** Live turns fail, open cards go away, and the next call restarts the server after a backoff. */
  private exited(gen: number, reason: number | string | null) {
    if (gen !== this.gen) return;
    const message = `Codex app-server exited (${reason})${this.stderr.trim() ? `: ${this.stderr.trim().split('\n').at(-1)}` : ''}`;
    this.crashes.push(Date.now());
    this.rpc?.close(message);
    this.rpc = undefined;
    this.child = undefined;
    this.ready = undefined;
    this.gen++;
    for (const [requestId, p] of this.requests) this.emit({ threadId: p.threadId, type: 'resolved', requestId });
    this.requests.clear();
    for (const [threadId, live] of this.threads) {
      if (!live.turnId) continue;
      live.turnId = undefined;
      this.emit({ threadId, type: 'turn-end', status: 'failed', error: message });
    }
  }

  private notification(method: string, params: unknown) {
    const live = this.byCodex.get(codexThreadId(params) ?? '');
    if (!live) return;
    const turnId = (params as { turn?: { id?: unknown } }).turn?.id;
    if (method === 'turn/started' && typeof turnId === 'string') live.turnId = turnId;
    if (method === 'turn/completed') live.turnId = undefined;
    for (const event of mapNotification(method, params, live.state)) {
      if (event.type === 'resolved' && !this.requests.delete(event.requestId)) continue;
      this.emit(event);
    }
  }

  private request(id: RpcId, method: string, params: unknown) {
    const live = this.byCodex.get(codexThreadId(params) ?? '');
    const requestId = requestKey(id);
    const event = live && mapRequest(method, params, requestId, live.state);
    if (!event) return this.rpc?.respondError(id, -32601, `Harness does not handle ${method}`);
    const questions = (params as { questions?: { id?: unknown }[] }).questions;
    const questionIds = Array.isArray(questions) ? questions.map((q) => String(q?.id)) : [];
    this.requests.set(requestId, { id, method, threadId: live.state.threadId, questionIds });
    this.emit(event);
  }

  private forget(threadId: string) {
    const live = this.threads.get(threadId);
    if (!live) return;
    this.threads.delete(threadId);
    this.byCodex.delete(live.codexId);
    for (const [requestId, p] of this.requests) if (p.threadId === threadId) this.requests.delete(requestId);
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
