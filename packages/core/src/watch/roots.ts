import { readFile } from 'node:fs/promises';
import path from 'node:path';
import watcher from '@parcel/watcher';
import { Effect, PubSub, RcMap, Stream } from 'effect';

export interface RootChange {
  /** Relative to the root, `/`-separated. */
  readonly path: string;
  readonly type: 'create' | 'update' | 'delete';
}

// Parcel's globs only save it work; this is what guarantees the rule whatever its glob dialect does.
const UNWATCHED = /(^|\/)node_modules(\/|$)|^\.git\/objects(\/|$)/;

// FSEvents replays the root's own recent creation right after subscribing; only its deletion says anything.
const isNoise = (change: RootChange) =>
  UNWATCHED.test(change.path) ||
  (change.path === '' && change.type !== 'delete');

/** One @parcel/watcher subscription per directory while anything holds it, shared by every key on that root. */
export const makeRoots = Effect.gen(function* () {
  const map = yield* RcMap.make({ lookup: subscribeRoot });
  /** `root`'s changes in batches, held from now on: a read started after this can't miss a change made before its stream runs. */
  return (root: string) =>
    Effect.map(
      Effect.flatMap(RcMap.get(map, root), PubSub.subscribe),
      Stream.fromSubscription,
    );
});

const subscribeRoot = (root: string) =>
  Effect.gen(function* () {
    const changes = yield* PubSub.unbounded<ReadonlyArray<RootChange>>();
    const ignore = [
      '**/node_modules',
      '**/node_modules/**',
      '.git/objects',
      ...(yield* gitignoreGlobs(root)),
    ];
    const onEvents = (
      error: Error | null,
      events: ReadonlyArray<watcher.Event>,
    ) => {
      // A deleted root or a lost FSEvents stream reports here; the keys' own reads then fail as values.
      if (error)
        return void Effect.runFork(
          Effect.logWarning(`Watching ${root} failed: ${error.message}`).pipe(
            Effect.annotateLogs({ source: 'watch' }),
          ),
        );
      const batch = events
        .map((e) => ({
          path: path.relative(root, e.path).split(path.sep).join('/'),
          type: e.type,
        }))
        .filter((e) => !isNoise(e));
      if (batch.length > 0) PubSub.publishUnsafe(changes, batch);
    };
    yield* Effect.acquireRelease(
      Effect.tryPromise(() =>
        watcher.subscribe(root, onEvents, { ignore }),
      ).pipe(
        // A root that doesn't exist (yet, or any more) has no changes to report.
        Effect.tapError((error) =>
          Effect.logWarning(`Can't watch ${root}: ${String(error)}`).pipe(
            Effect.annotateLogs({ source: 'watch' }),
          ),
        ),
        Effect.option,
      ),
      (subscription) =>
        subscription._tag === 'Some'
          ? Effect.promise(() =>
              subscription.value.unsubscribe().catch(() => {}),
            )
          : Effect.void,
    );
    return changes;
  });

// ponytail: the root's own .gitignore, plain patterns only (no negation, no nested files); parcel just watches more otherwise.
const gitignoreGlobs = (root: string) =>
  Effect.promise(() =>
    readFile(path.join(root, '.gitignore'), 'utf8').catch(() => ''),
  ).pipe(Effect.map(globsOf));

export function globsOf(gitignore: string) {
  return gitignore
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
    .flatMap((line) => {
      const pattern = line.replace(/^\//, '').replace(/\/$/, '');
      const glob = line.startsWith('/') ? pattern : `**/${pattern}`;
      return [glob, `${glob}/**`];
    });
}
