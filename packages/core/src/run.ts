import { Cause, Context, Duration, Effect, Layer, Queue, Semaphore, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { RunError } from './rpc.ts';
import { userPath } from './shellPath.ts';

export { RunError };

/** Whatever stops a run besides a bad exit code (no such binary, timeout) as a RunError too. */
export const asRunError = (command: string) => (cause: unknown) =>
  cause instanceof RunError
    ? cause
    : new RunError({ command, code: -1, stderr: cause instanceof Error ? cause.message : String(cause), timedOut: Cause.isTimeoutError(cause) });

export interface RunOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly input?: string;
  readonly timeout?: Duration.Input;
  /** Exit codes that count as success; `[0]` unless set. */
  readonly okCodes?: ReadonlyArray<number>;
  /** The semaphore to wait on; the binary's name unless set. */
  readonly queue?: string;
  /** Run through cmd.exe / sh, for Windows `.cmd` shims. */
  readonly shell?: boolean;
}

export interface SpawnOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly shell?: boolean;
  /** Ends the process and the stream when it passes. */
  readonly timeout?: Duration.Input;
}

export type SpawnEvent =
  | { readonly _tag: 'started'; readonly id: number }
  | { readonly _tag: 'out'; readonly stream: 'stdout' | 'stderr'; readonly data: Uint8Array }
  | { readonly _tag: 'exit'; readonly code: number | null; readonly timedOut?: boolean };

/** Concurrency caps per queue. A queue not listed here runs unbounded. */
const QUEUE_PERMITS: Record<string, number> = { git: 4, gh: 4, lsof: 1 };

/** Child processes with the login-shell PATH. Interrupting the calling fiber kills the process group. */
export class Run extends Context.Service<Run>()('mochi/core/Run', {
  make: Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const PATH = yield* Effect.promise(userPath);
    const semaphores = new Map<string, Semaphore.Semaphore>();
    const semaphoreFor = (queue: string) => {
      const permits = QUEUE_PERMITS[queue];
      if (permits === undefined) return undefined;
      const semaphore = semaphores.get(queue) ?? Semaphore.makeUnsafe(permits);
      semaphores.set(queue, semaphore);
      return semaphore;
    };
    const describe = (command: string, args: ReadonlyArray<string>) => [command, ...args].join(' ');

    const exec = (command: string, args: ReadonlyArray<string>, options: RunOptions) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make(command, args, {
              cwd: options.cwd,
              env: { PATH, ...options.env },
              extendEnv: true,
              shell: options.shell,
              stdin: options.input === undefined ? 'ignore' : { stream: Stream.make(new TextEncoder().encode(options.input)) },
            }),
          );
          const [stdout, stderr, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode], {
            concurrency: 'unbounded',
          });
          if (!(options.okCodes ?? [0]).includes(code)) return yield* new RunError({ command: describe(command, args), code, stderr, stdout });
          return { stdout, stderr, code };
        }),
      );

    const run = (command: string, args: ReadonlyArray<string> = [], options: RunOptions = {}) => {
      const semaphore = semaphoreFor(options.queue ?? command);
      const bounded = semaphore ? semaphore.withPermits(1)(exec(command, args, options)) : exec(command, args, options);
      return options.timeout === undefined ? bounded : Effect.timeout(bounded, options.timeout);
    };

    // A spawn's stdin and signals are reached by process id from other RPC calls; the stream's scope owns the process.
    const live = new Map<number, { stdin: Queue.Queue<Uint8Array, Cause.Done>; kill: (signal: NodeJS.Signals) => Effect.Effect<void> }>();

    /** A long-lived process: its output as events. Ending or interrupting the stream kills the tree. */
    const spawn = (command: string, args: ReadonlyArray<string> = [], options: SpawnOptions = {}): Stream.Stream<SpawnEvent, RunError> =>
      Stream.callback<SpawnEvent, RunError>((events) =>
        Effect.gen(function* () {
          const stdin = yield* Queue.unbounded<Uint8Array, Cause.Done>();
          const handle = yield* spawner.spawn(
            ChildProcess.make(command, args, { cwd: options.cwd, env: { PATH, ...options.env }, extendEnv: true, shell: options.shell, stdin: { stream: Stream.fromQueue(stdin) } }),
          );
          const id = handle.pid;
          live.set(id, { stdin, kill: (killSignal) => handle.kill({ killSignal }).pipe(Effect.ignore) });
          yield* Effect.addFinalizer(() => Effect.sync(() => live.delete(id)));
          yield* Queue.offer(events, { _tag: 'started', id });
          const pump = (stream: 'stdout' | 'stderr') =>
            handle[stream].pipe(Stream.runForEach((data) => Queue.offer(events, { _tag: 'out', stream, data })), Effect.ignore);
          yield* Effect.all([pump('stdout'), pump('stderr')], { concurrency: 'unbounded' }).pipe(
            Effect.andThen(handle.exitCode),
            Effect.flatMap((code) => Queue.offer(events, { _tag: 'exit', code })),
            Effect.catch(() => Queue.offer(events, { _tag: 'exit', code: null })),
            Effect.andThen(Queue.end(events)),
            Effect.forkScoped,
          );
          if (options.timeout !== undefined)
            yield* Effect.sleep(options.timeout).pipe(
              Effect.andThen(Queue.offer(events, { _tag: 'exit', code: null, timedOut: true })),
              Effect.andThen(Queue.end(events)),
              Effect.forkScoped,
            );
        }).pipe(Effect.catch((cause) => Effect.fail(new RunError({ command: describe(command, args), code: -1, stderr: String(cause) })))),
      );

    const write = (id: number, data: Uint8Array | null) => {
      const process = live.get(id);
      if (!process) return Effect.void;
      return data ? Queue.offer(process.stdin, data).pipe(Effect.asVoid) : Queue.end(process.stdin).pipe(Effect.asVoid);
    };
    const signal = (id: number, killSignal: NodeJS.Signals) => live.get(id)?.kill(killSignal) ?? Effect.void;
    return { run, spawn, write, signal };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
