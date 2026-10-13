import { useEffect, useReducer, useSyncExternalStore } from 'react';
import { host } from '@/host';
import { refKey, type GithubRef, type RefState, type RepoSlug } from './refs';

// ponytail: module-level cache, one per window. Entries older than TTL refetch on the next mount or window focus; nothing polls.
const TTL_MS = 60_000;
const BATCH_MS = 40;

type Entry = { state: RefState | null; at: number };
type Scope = { cwd: string | null; githubUser?: string };

const cache = new Map<string, Entry>();
const inFlight = new Set<string>();
const queued = new Map<string, { scope: Scope; refs: Map<string, GithubRef> }>();
const mounted = new Map<string, { ref: GithubRef; scope: Scope; count: number }>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Live state of a PR or issue, `undefined` until first read, `null` when gh couldn't read it. Batched with every other chip on screen. */
export function useRefState(ref: GithubRef, scope: Scope) {
  const key = refKey(ref);
  const { cwd, githubUser } = scope;
  useEffect(() => {
    const seen = mounted.get(key);
    mounted.set(key, { ref, scope: { cwd, githubUser }, count: (seen?.count ?? 0) + 1 });
    request(key, ref, { cwd, githubUser });
    return () => {
      const m = mounted.get(key);
      if (m && --m.count === 0) mounted.delete(key);
    };
  }, [key, cwd, githubUser]);
  return useSyncExternalStore(subscribe, () => cache.get(key)?.state);
}

function request(key: string, ref: GithubRef, scope: Scope) {
  const entry = cache.get(key);
  if (inFlight.has(key) || (entry && Date.now() - entry.at < TTL_MS)) return;
  const scopeKey = `${scope.cwd ?? ''}\u0000${scope.githubUser ?? ''}`;
  const batch = queued.get(scopeKey) ?? { scope, refs: new Map() };
  batch.refs.set(key, ref);
  queued.set(scopeKey, batch);
  timer ??= setTimeout(flush, BATCH_MS);
}

function flush() {
  timer = undefined;
  const batches = [...queued.values()];
  queued.clear();
  for (const { scope, refs } of batches) {
    const keys = [...refs.keys()];
    keys.forEach((k) => inFlight.add(k));
    void host.git
      .refStates(scope.cwd, [...refs.values()], scope.githubUser)
      .catch(() => ({}) as Record<string, RefState>)
      .then((states) => {
        const at = Date.now();
        for (const k of keys) {
          inFlight.delete(k);
          cache.set(k, { state: states[k] ?? null, at });
        }
        listeners.forEach((l) => l());
      });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== 'undefined')
  window.addEventListener('focus', () => {
    for (const [key, { ref, scope }] of mounted) {
      const entry = cache.get(key);
      // A focus within a few seconds of the last read isn't worth a gh call.
      if (entry && Date.now() - entry.at > FOCUS_STALE_MS) cache.set(key, { ...entry, at: 0 });
      request(key, ref, scope);
    }
  });

const FOCUS_STALE_MS = 10_000;

const slugs = new Map<string, Promise<RepoSlug | null>>();
const slugValues = new Map<string, RepoSlug | null>();

/** The thread's GitHub `owner/repo` from origin, read once per folder. */
export function useRepoSlug(cwd: string | null) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!cwd || slugValues.has(cwd)) return;
    let isCurrent = true;
    if (!slugs.has(cwd))
      slugs.set(
        cwd,
        host.git.repoSlug(cwd).then(
          (s) => (slugValues.set(cwd, s), s),
          () => (slugValues.set(cwd, null), null),
        ),
      );
    void slugs.get(cwd)!.then(() => isCurrent && rerender());
    return () => {
      isCurrent = false;
    };
  }, [cwd]);
  return cwd ? (slugValues.get(cwd) ?? null) : null;
}
