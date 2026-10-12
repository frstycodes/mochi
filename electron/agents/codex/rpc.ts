import type { Readable, Writable } from 'node:stream';

export type RpcId = string | number;
export type RpcMessage =
  | { kind: 'response'; id: RpcId; result?: unknown; error?: { code: number; message: string } }
  | { kind: 'request'; id: RpcId; method: string; params: unknown }
  | { kind: 'notification'; method: string; params: unknown };

export interface RpcHandlers {
  onNotification(method: string, params: unknown): void;
  onRequest(id: RpcId, method: string, params: unknown): void;
  /** A line that isn't a valid message, or a response nobody waits for. Never acted on. */
  onInvalid(reason: string, line: string): void;
}

// app-server speaks JSON-RPC 2.0 without the `jsonrpc` field, one message per line (verified against codex 0.155.1).
// Long thread payloads (`thread/resume` with history) can be large; anything past this is treated as a broken stream.
const MAX_LINE = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export class RpcClient {
  private nextId = 1;
  private buffer = '';
  private pending = new Map<RpcId, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  private output: Writable;
  private handlers: RpcHandlers;

  constructor(input: Readable, output: Writable, handlers: RpcHandlers) {
    this.output = output;
    this.handlers = handlers;
    input.setEncoding('utf8');
    input.on('data', (chunk: string) => this.receive(chunk));
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codex ${method} timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown) {
    this.write(params === undefined ? { method } : { method, params });
  }

  respond(id: RpcId, result: unknown) {
    this.write({ id, result });
  }

  respondError(id: RpcId, code: number, message: string) {
    this.write({ id, error: { code, message } });
  }

  /** Rejects every waiting request; call when the child exits. */
  close(reason: string) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error(reason));
    }
    this.pending.clear();
  }

  private write(message: object) {
    if (this.output.writable) this.output.write(`${JSON.stringify(message)}\n`);
  }

  private receive(chunk: string) {
    this.buffer += chunk;
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (line) this.dispatch(line);
    }
    if (this.buffer.length <= MAX_LINE) return;
    this.handlers.onInvalid('line too long', this.buffer.slice(0, 200));
    this.buffer = '';
  }

  private dispatch(line: string) {
    const message = parseMessage(line);
    if (typeof message === 'string') return this.handlers.onInvalid(message, line.slice(0, 200));
    if (message.kind === 'notification') return this.handlers.onNotification(message.method, message.params);
    if (message.kind === 'request') return this.handlers.onRequest(message.id, message.method, message.params);
    const waiting = this.pending.get(message.id);
    if (!waiting) return this.handlers.onInvalid('response to an unknown request', line.slice(0, 200));
    this.pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  }
}

/** A validated message, or why the line isn't one. */
export function parseMessage(line: string): RpcMessage | string {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return 'not JSON';
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'not an object';
  const m = value as Record<string, unknown>;
  const hasId = typeof m.id === 'string' || (typeof m.id === 'number' && Number.isInteger(m.id));
  if (typeof m.method === 'string') {
    if (m.params !== undefined && (typeof m.params !== 'object' || m.params === null)) return 'params is not an object';
    return hasId ? { kind: 'request', id: m.id as RpcId, method: m.method, params: m.params ?? {} } : { kind: 'notification', method: m.method, params: m.params ?? {} };
  }
  if (!hasId) return 'no method and no id';
  if ('error' in m) {
    const e = m.error as Record<string, unknown> | null;
    if (typeof e !== 'object' || e === null || typeof e.message !== 'string') return 'malformed error';
    return { kind: 'response', id: m.id as RpcId, error: { code: typeof e.code === 'number' ? e.code : 0, message: e.message } };
  }
  if (!('result' in m)) return 'response without result or error';
  return { kind: 'response', id: m.id as RpcId, result: m.result };
}
