import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { Effect, Layer, Stream } from 'effect';
import type { makeCoreClient } from './client.ts';
import { asRunError, RunError, type Run } from './run.ts';

// No `electron` import: electron/git/run.ts goes through this, and its tests run under plain node.

export { RunError };

type Client = Effect.Success<ReturnType<typeof makeCoreClient>>;

export interface RunCommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  input?: string;
  /** Milliseconds; the run fails with `timedOut` when it passes. */
  timeout?: number;
  okCodes?: number[];
  queue?: string;
  shell?: boolean;
  signal?: AbortSignal;
}

let backend: Promise<Client> | undefined;

/** Main points this at Core's RPC client on each (re)connect. Until then, and in plain-node tests, commands run in-process through the same `Run` service. */
export function useCoreClient(client: Promise<Client>) {
  backend = client;
}

/** Core's client once main has connected; undefined before then and in plain-node tests. */
export const connectedCore = () => backend;

let local: Promise<Client> | undefined;
// ponytail: in-process only for tests and the moment before Core connects; same service, no second implementation.
function localClient(): Promise<Client> {
  local ??= (async () => {
    const [{ NodeServices }, { Run }] = await Promise.all([import('@effect/platform-node'), import('./run.ts')]);
    return clientFromRun(await Effect.runPromise(Effect.service(Run).pipe(Effect.provide(Run.layer.pipe(Layer.provide(NodeServices.layer))))));
  })();
  return local;
}

/** The calls this module makes, served by a `Run` in this process: Core's own, so its agents' processes are Core's children. */
export function clientFromRun(run: Run['Service']): Client {
  return {
    run: (p: { command: string; args: readonly string[]; timeoutMs?: number; env?: Record<string, string> }) =>
      run.run(p.command, p.args, { ...p, timeout: p.timeoutMs }).pipe(Effect.mapError(asRunError(p.command))),
    spawn: (p: { command: string; args: readonly string[]; timeoutMs?: number }) => run.spawn(p.command, p.args, { ...p, timeout: p.timeoutMs }),
    stdin: (p: { id: number; data: Uint8Array | null }) => run.write(p.id, p.data),
    signal: (p: { id: number; signal: string }) => run.signal(p.id, p.signal as NodeJS.Signals),
  } as unknown as Client;
}

const client = () => backend ?? localClient();
const cleanEnv = (env?: Record<string, string | undefined>) => (env ? (Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string>) : undefined);

/** One command to completion, in Core: login-shell PATH, a timeout, and `signal` to cancel. Rejects with RunError. */
export async function runCommand(command: string, args: readonly string[] = [], options: RunCommandOptions = {}) {
  const { signal, timeout, env, ...rest } = options;
  const rpc = await client();
  return Effect.runPromise(rpc.run({ command, args, ...rest, env: cleanEnv(env), timeoutMs: timeout }) as Effect.Effect<{ stdout: string; stderr: string; code: number }, RunError>, { signal });
}

export interface CoreChild extends EventEmitter {
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly stdin: Writable;
  /** Core's process id, not an OS pid you can signal from here. */
  pid: number | undefined;
  /** Null while running; the exit code once `exit` fired (null still, when killed). */
  exitCode: number | null;
  hasExited: boolean;
  kill(signal?: NodeJS.Signals): void;
}

export interface SpawnCommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  shell?: boolean;
  timeout?: number;
}

/**
 * A long-lived process in Core, shaped like node's ChildProcess for what callers use: `stdout`/`stderr` streams, `stdin`,
 * `kill(signal)`, and `exit`/`close`/`error` events. `kill()` with no signal, like the `SIGINT` a recording needs, goes to the
 * process; the tree dies with it. An `exit` code of `null` means killed or timed out.
 */
export function spawnCommand(command: string, args: readonly string[] = [], options: SpawnCommandOptions = {}): CoreChild {
  const child = new EventEmitter() as CoreChild;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const abort = new AbortController();
  let id: number | undefined;
  const ready = new Promise<void>((resolve) => child.once('started', resolve));
  const stdin = new Writable({
    write: (chunk: Buffer, _encoding, done) => void send((rpc) => rpc.stdin({ id: id!, data: chunk })).then(() => done(), done),
    final: (done) => void send((rpc) => rpc.stdin({ id: id!, data: null })).then(() => done(), done),
  });
  const send = async (call: (rpc: Client) => unknown) => {
    await ready;
    await Effect.runPromise(call(await client()) as Effect.Effect<void>);
  };
  // A write to a process that already died fails; its `exit` event is what callers watch.
  stdin.on('error', () => {});
  Object.assign(child, { stdout, stderr, stdin, pid: undefined, exitCode: null, hasExited: false });
  child.kill = (signal = 'SIGTERM') => void (id === undefined ? abort.abort() : send((rpc) => rpc.signal({ id: id!, signal })).catch(() => {}));

  let exited = false;
  // `exit` and `close` come after a reader has taken the last output, as with node's ChildProcess.
  const drained = (stream: PassThrough) => (stream.readableFlowing ? new Promise((resolve) => stream.once('end', resolve)) : Promise.resolve());
  const finish = (code: number | null) => {
    if (exited) return;
    exited = true;
    child.exitCode = code;
    child.hasExited = true;
    stdout.end();
    stderr.end();
    stdin.destroy();
    void Promise.all([drained(stdout), drained(stderr)]).then(() => {
      child.emit('exit', code, null);
      child.emit('close', code, null);
    });
  };
  void client()
    .then((rpc) =>
      Effect.runPromise(
        (rpc.spawn({ command, args, cwd: options.cwd, env: cleanEnv(options.env), shell: options.shell, timeoutMs: options.timeout }) as Stream.Stream<{ _tag: string; id?: number; stream?: 'stdout' | 'stderr'; data?: Uint8Array; code?: number | null }, RunError>).pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (event._tag === 'started') (child.pid = id = event.id), child.emit('started');
              else if (event._tag === 'out') (event.stream === 'stdout' ? stdout : stderr).write(event.data);
              else if (event._tag === 'exit') finish(event.code ?? null);
            }),
          ),
        ),
        { signal: abort.signal },
      ),
    )
    .then(() => finish(null), (error: unknown) => {
      if (exited) return;
      if (abort.signal.aborted) return finish(null);
      child.emit('error', error);
      finish(null);
    });
  return child;
}
