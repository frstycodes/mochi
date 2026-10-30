import { Context, Deferred, Effect, Layer, Semaphore } from 'effect';

/** Lower runs first: titles are on screen, the rest can wait. */
export const PRIORITY = {
  title: 1,
  command: 1,
  simplify: 3,
  commit: 3,
  pr: 3,
  handoff: 3,
} as const satisfies Record<string, number>;

export interface Job {
  /** One live job per (thread, kind): submitting another cancels this one, queued or running. No thread, no replacing. */
  readonly thread?: string;
  readonly kind: string;
  readonly priority: number;
  /** Characters sent, for the token estimate. */
  readonly promptChars: number;
  readonly run: Effect.Effect<string | null>;
}

interface Entry extends Job {
  readonly seq: number;
  readonly key: string;
  /** Completes with the answer, or null when the job was replaced. */
  readonly settled: Deferred.Deferred<string | null>;
}

export interface UtilityStats {
  jobs: number;
  replaced: number;
  /** ~4 characters a token; the model calls report no usage yet. */
  tokensIn: number;
  tokensOut: number;
}

/**
 * The utility model's job queue. One job runs at a time (the warm spare process serves one call), picked by priority
 * then arrival; a newer job for the same (thread, kind) cancels the older one, which resolves to null so its caller
 * keeps its local behaviour.
 */
export class UtilityQueue extends Context.Service<UtilityQueue>()(
  'mochi/core/UtilityQueue',
  {
    make: Effect.sync(() => {
      const spare = Semaphore.makeUnsafe(1);
      const live = new Map<string, Entry>();
      const waiting = new Set<Entry>();
      const stats: UtilityStats = {
        jobs: 0,
        replaced: 0,
        tokensIn: 0,
        tokensOut: 0,
      };
      let seq = 0;

      const next = () =>
        [...waiting].sort(
          (a, b) => a.priority - b.priority || a.seq - b.seq,
        )[0];

      // One drain per submit; whichever holds the permit takes the best waiting entry, so the queue is ordered by priority and not by arrival at the semaphore.
      const drain = spare.withPermits(1)(
        Effect.suspend(() => {
          const entry = next();
          if (!entry) return Effect.void;
          waiting.delete(entry);
          return Effect.raceFirst(
            entry.run,
            Deferred.await(entry.settled),
          ).pipe(
            Effect.flatMap((answer) => {
              stats.jobs++;
              stats.tokensIn += Math.ceil(entry.promptChars / 4);
              stats.tokensOut += Math.ceil((answer?.length ?? 0) / 4);
              return Deferred.succeed(entry.settled, answer);
            }),
            Effect.ensuring(
              Effect.sync(
                () => live.get(entry.key) === entry && live.delete(entry.key),
              ),
            ),
          );
        }),
      );

      const submit = (job: Job) =>
        Effect.gen(function* () {
          const key = `${job.thread ?? `#${seq}`}\0${job.kind}`;
          const older = live.get(key);
          if (older) {
            waiting.delete(older);
            stats.replaced++;
            Deferred.doneUnsafe(older.settled, Effect.succeed(null));
          }
          const entry: Entry = {
            ...job,
            key,
            seq: seq++,
            settled: yield* Deferred.make<string | null>(),
          };
          live.set(key, entry);
          waiting.add(entry);
          yield* Effect.forkDetach(drain);
          return yield* Deferred.await(entry.settled).pipe(
            // The caller went away: drop a job nobody waits for.
            Effect.onInterrupt(() =>
              Effect.sync(
                () => (
                  waiting.delete(entry),
                  Deferred.doneUnsafe(entry.settled, Effect.succeed(null))
                ),
              ),
            ),
          );
        });

      return {
        submit,
        stats: Effect.sync((): Readonly<UtilityStats> => ({ ...stats })),
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
