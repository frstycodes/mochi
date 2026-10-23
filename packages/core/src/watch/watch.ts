import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Clock, Context, Effect, Layer, Queue, RcMap, RcRef, Scope, Stream, SubscriptionRef } from 'effect';
import { hostHandlers, Capabilities } from '../hostServer.ts';
import { Run } from '../run.ts';
import type { Git, Ports, Sim } from '@mochi/schema';
import type { Gate, StaleKind, WatchKey, WatchValue } from './keys.ts';
import { makeRoots } from './roots.ts';

export interface WatchDeps {
  /** `host.<namespace>.<method>`, served by the client that registered it (main); a failure is its message. */
  readonly host: (tag: string, args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown>;
  readonly run: (command: string, args: ReadonlyArray<string>, options: { cwd: string; queue: string; timeout: number }) => Effect.Effect<{ stdout: string }, unknown>;
  /** Ticks when Core starts or reaps a long-lived child: a dev server may have bound or released a port. */
  readonly children: Stream.Stream<unknown>;
}

const DEBOUNCE_MS = 150;
/** While no window is visible, a read waits for this long at most; a key with nothing stale skips it. */
const HIDDEN_MS = 60_000;
const PORTS_MS = 5_000;
const SIM_MS = 5_000;
const ON_BATTERY_FACTOR = 3;
const GIT_TIMEOUT_MS = 30_000;
// ponytail: a fingerprint stats at most this many changed paths; past it, edits to the rest go unseen until the status itself changes.
const MAX_STATS = 2_000;

interface Spec {
  /** Read on this interval while a window is visible; event-driven keys leave it unset. */
  readonly visibleMs?: number;
  /** Read on every interval even with nothing marked stale: keys with no change events of their own. */
  readonly isPoll: boolean;
}

interface Topic<A> {
  readonly value: SubscriptionRef.SubscriptionRef<A | Failed | undefined>;
  readonly markStale: Effect.Effect<void>;
}

type Failed = Extract<WatchValue, { _tag: 'error' }>;

/**
 * Every watch key's reader, shared: subscribers of an equal key get one reader, which runs while any of them is
 * subscribed and replays its last value to a new one. Reads are gated by `setGate`.
 */
export const makeWatch = (deps: WatchDeps) =>
  Effect.gen(function* () {
    const gate = yield* SubscriptionRef.make<Gate>({ isVisible: true, isAsleep: false, isOnBattery: false });
    const topics = new Set<{ kind: StaleKind; wake: Queue.Queue<void>; markStale: () => void }>();
    const roots = yield* makeRoots;

    /** Reads now, then whenever the gate lets a trigger through, until the caller's scope closes. */
    const topic = <A>(kind: StaleKind, spec: Spec, read: Effect.Effect<A, unknown>) =>
      Effect.gen(function* () {
        const value = yield* SubscriptionRef.make<A | Failed | undefined>(undefined);
        const wake = yield* Queue.sliding<void>(1);
        let isDirty = true;
        const entry = {
          kind,
          wake,
          markStale: () => {
            isDirty = true;
            Queue.offerUnsafe(wake, undefined);
          },
        };
        topics.add(entry);
        yield* Effect.addFinalizer(() => Effect.sync(() => topics.delete(entry)));

        let lastRead = 0;
        const loop = Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const { isVisible, isAsleep, isOnBattery } = yield* SubscriptionRef.get(gate);
          const intervalMs = isAsleep ? undefined : (isVisible ? spec.visibleMs : HIDDEN_MS);
          const waitMs = intervalMs === undefined ? undefined : intervalMs * (isOnBattery ? ON_BATTERY_FACTOR : 1);
          const isDue = waitMs !== undefined && now - lastRead >= waitMs;
          if (!isAsleep && ((isDirty && isVisible) || (isDue && (isDirty || spec.isPoll)))) {
            // A burst of saves is one read; the first read doesn't wait.
            if (lastRead > 0 && !isDue) yield* Effect.sleep(DEBOUNCE_MS);
            isDirty = false;
            lastRead = yield* Clock.currentTimeMillis;
            return yield* SubscriptionRef.set(value, yield* asValue(read));
          }
          const timer = waitMs === undefined ? Effect.never : Effect.sleep(lastRead + waitMs - now);
          yield* Effect.raceFirst(Queue.take(wake), timer);
        });
        yield* Effect.forkScoped(Effect.forever(loop));
        return { value, markStale: Effect.sync(entry.markStale) } satisfies Topic<A>;
      });

    const asValue = <A>(read: Effect.Effect<A, unknown>) => read.pipe(Effect.catch((error) => Effect.succeed<Failed>({ _tag: 'error', message: messageOf(error) })));
    const forkEach = <A>(stream: Stream.Stream<A>, f: (a: A) => Effect.Effect<void>) => Effect.forkScoped(Stream.runForEach(stream, f));

    const files = yield* RcMap.make({
      lookup: (root: string) =>
        Effect.gen(function* () {
          const files = yield* topic('files', { isPoll: false }, Effect.map(deps.host('fs.list', [root]), (files): WatchValue => ({ _tag: 'files', files: files as string[] })));
          // Only a create or delete changes the list; .git's churn never does.
          yield* forkEach(roots(root), (batch) => (batch.some((c) => c.type !== 'update' && !isGitPath(c.path)) ? files.markStale : Effect.void));
          return files;
        }),
    });

    const gitStatus = yield* RcMap.make({
      lookup: (cwd: string) =>
        Effect.gen(function* () {
          const where = yield* deps.run('git', ['rev-parse', '--show-toplevel', '--absolute-git-dir'], { cwd, queue: 'git', timeout: GIT_TIMEOUT_MS }).pipe(
            Effect.map(({ stdout }) => stdout.trim().split('\n') as [string, string]),
            Effect.orElseSucceed(() => [cwd, ''] as const),
          );
          const [top, gitDir] = where;
          const status = yield* topic('git', { isPoll: false }, fingerprint(deps, top));
          yield* forkEach(roots(top), () => status.markStale);
          // A linked worktree keeps its index under the main repo's .git/worktrees, outside the tree watched above.
          if (gitDir && !isInside(gitDir, top)) yield* forkEach(roots(gitDir), () => status.markStale);
          return status;
        }),
    });

    const gitDiff = yield* RcMap.make({
      lookup: (json: string) =>
        Effect.gen(function* () {
          const { cwd, scope, base } = JSON.parse(json) as Extract<WatchKey, { _tag: 'gitDiff' }>;
          const status = yield* RcMap.get(gitStatus, cwd);
          const value = yield* SubscriptionRef.make<WatchValue | undefined>(undefined);
          const readDiff = asValue(Effect.map(deps.host('git.diff', [cwd, scope, base]), (diff): WatchValue => ({ _tag: 'gitDiff', diff: diff as Git.GitDiff })));
          // The full diff only when the fingerprint moved; an unchanged worktree costs one `git status`.
          yield* forkEach(Stream.changesWith(defined(SubscriptionRef.changes(status.value)), sameValue), (fingerprint) =>
            typeof fingerprint === 'string' ? Effect.flatMap(readDiff, (diff) => SubscriptionRef.set(value, diff)) : SubscriptionRef.set(value, fingerprint),
          );
          return { value, markStale: status.markStale } satisfies Topic<WatchValue>;
        }),
    });

    // One `lsof` for every subscribed cwd; each subscriber picks its own listing out of the shared result.
    const portCwds = new Map<string, number>();
    const ports = yield* RcRef.make({
      acquire: Effect.gen(function* () {
        const read = Effect.suspend(() => {
          const cwds = [...portCwds.keys()];
          return Effect.map(deps.host('ports.list', [cwds]), (listings) => zip(cwds, listings as Ports.PortsListing[]));
        });
        const scan = yield* topic('ports', { visibleMs: PORTS_MS, isPoll: true }, read);
        yield* forkEach(deps.children, () => scan.markStale);
        return scan;
      }),
    });

    const sim = yield* RcRef.make({
      acquire: topic('sim', { visibleMs: SIM_MS, isPoll: true }, Effect.map(deps.host('sim.list', []), (simulators): WatchValue => ({ _tag: 'sim', simulators: simulators as Sim.Simulator[] }))),
    });

    const follow = (topic: Effect.Effect<Topic<WatchValue>, never, Scope.Scope>) => Stream.unwrap(Effect.map(topic, (t) => defined(SubscriptionRef.changes(t.value))));

    const portsOf = (cwd: string): Stream.Stream<WatchValue> =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => portCwds.set(cwd, (portCwds.get(cwd) ?? 0) + 1)),
            () => Effect.sync(() => (portCwds.get(cwd) === 1 ? portCwds.delete(cwd) : portCwds.set(cwd, portCwds.get(cwd)! - 1))),
          );
          const scan = yield* RcRef.get(ports);
          // A new cwd joins the next scan now rather than at the next interval.
          yield* scan.markStale;
          return defined(SubscriptionRef.changes(scan.value)).pipe(
            // A scan that began before this cwd joined has nothing for it; the one `markStale` queued does.
            Stream.filter((scanned) => !(scanned instanceof Map) || scanned.has(cwd)),
            Stream.map((scanned): WatchValue => (scanned instanceof Map ? { _tag: 'ports', listing: scanned.get(cwd)! } : scanned)),
            Stream.changesWith(sameValue),
          );
        }),
      );

    /** The key's values: the current one first (once read), then each change. */
    const watch = (key: WatchKey): Stream.Stream<WatchValue> => {
      switch (key._tag) {
        case 'files':
          return follow(RcMap.get(files, key.root));
        case 'changes':
          return roots(key.root).pipe(
            Stream.map((batch) => batch.filter((c) => !isGitPath(c.path)).map((c) => c.path)),
            Stream.filter((paths) => paths.length > 0),
            Stream.map((paths) => ({ _tag: 'changes', paths }) as const),
          );
        case 'gitDiff':
          return follow(RcMap.get(gitDiff, JSON.stringify({ cwd: key.cwd, scope: key.scope, base: key.base })));
        case 'ports':
          return portsOf(key.cwd);
        case 'sim':
          return follow(RcRef.get(sim));
      }
    };

    const setGate = (next: Gate) =>
      Effect.gen(function* () {
        const before = yield* SubscriptionRef.get(gate);
        yield* SubscriptionRef.set(gate, next);
        // Nothing was watched while asleep, so every key reads once on waking.
        const isWaking = before.isAsleep && !next.isAsleep;
        for (const t of topics) {
          if (isWaking) t.markStale();
          else Queue.offerUnsafe(t.wake, undefined);
        }
      });

    /**
     * Something the watcher can't see may have changed these: an agent's Edit, Write or Bash ended (a commit, a dev server
     * started), or the user pressed refresh.
     */
    const markStale = (kinds: ReadonlyArray<StaleKind>) =>
      Effect.sync(() => {
        for (const t of topics) if (kinds.includes(t.kind)) t.markStale();
      });

    return { watch, setGate, markStale };
  });

export class Watch extends Context.Service<Watch>()('mochi/core/Watch', {
  make: Effect.gen(function* () {
    const run = yield* Run;
    const host = hostHandlers(yield* Capabilities, undefined) as Record<string, (args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown>>;
    return yield* makeWatch({ host: (tag, args) => host[tag]!(args), run: run.run, children: run.children });
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

/** `git status` plus the size and mtime of every path it lists: an edit to an already-modified file changes it too. */
const fingerprint = (deps: WatchDeps, top: string) =>
  Effect.gen(function* () {
    const { stdout } = yield* deps.run('git', ['--no-optional-locks', 'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], { cwd: top, queue: 'git', timeout: GIT_TIMEOUT_MS });
    const stats = yield* Effect.promise(() =>
      Promise.all(statusPaths(stdout).slice(0, MAX_STATS).map((p) => stat(path.join(top, p)).then((s) => `${s.size}:${s.mtimeMs}`, () => '-'))),
    );
    return createHash('sha1').update(stdout).update(stats.join(',')).digest('hex');
  });

/** Paths in `git status --porcelain=v2 -z` output: ordinary, renamed (whose next entry is the old path), unmerged and untracked. */
export function statusPaths(output: string) {
  const entries = output.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const fields = entry.split(' ');
    if (entry.startsWith('1 ')) paths.push(fields.slice(8).join(' '));
    else if (entry.startsWith('2 ')) paths.push(fields.slice(9).join(' '), entries[++i]!);
    else if (entry.startsWith('u ')) paths.push(fields.slice(10).join(' '));
    else if (entry.startsWith('? ')) paths.push(entry.slice(2));
  }
  return paths;
}

const defined = <A>(stream: Stream.Stream<A | undefined>) => Stream.filter(stream, (a): a is A => a !== undefined);
const sameValue = <A>(a: A, b: A) => JSON.stringify(a) === JSON.stringify(b);
const isGitPath = (p: string) => p === '.git' || p.startsWith('.git/');
const isInside = (child: string, parent: string) => !path.relative(parent, child).startsWith('..');
const zip = <A>(keys: ReadonlyArray<string>, values: ReadonlyArray<A>) => new Map(keys.map((k, i) => [k, values[i]!]));
const messageOf = (error: unknown) => (typeof error === 'string' ? error : error instanceof Error ? error.message : String(error));
