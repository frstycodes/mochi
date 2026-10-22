import { Context, Data, Duration, Effect, Layer, Semaphore, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { userPath } from './shellPath.ts';

export class RunError extends Data.TaggedError('RunError')<{ command: string; code: number; stderr: string }> {}

export interface RunOptions {
  readonly cwd?: string;
  readonly timeout?: Duration.Input;
  /** Exit codes that count as success; `[0]` unless set. */
  readonly okCodes?: ReadonlyArray<number>;
  /** The semaphore to wait on; the binary's name unless set. */
  readonly queue?: string;
}

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

    const exec = (command: string, args: ReadonlyArray<string>, options: RunOptions) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(ChildProcess.make(command, args, { cwd: options.cwd, env: { PATH }, extendEnv: true }));
          const [stdout, stderr, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode], {
            concurrency: 'unbounded',
          });
          if (!(options.okCodes ?? [0]).includes(code)) return yield* new RunError({ command: [command, ...args].join(' '), code, stderr });
          return { stdout, stderr, code };
        }),
      );

    const run = (command: string, args: ReadonlyArray<string> = [], options: RunOptions = {}) => {
      const semaphore = semaphoreFor(options.queue ?? command);
      const bounded = semaphore ? semaphore.withPermits(1)(exec(command, args, options)) : exec(command, args, options);
      return options.timeout === undefined ? bounded : Effect.timeout(bounded, options.timeout);
    };
    return { run };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
