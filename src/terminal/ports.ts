import { useQuery } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { host } from '../host/index.ts';
import type { ListeningPort, PortsListing } from '../host/types/ports.ts';
import { recordListeningPorts } from './devServer.ts';
import { queryKeys } from '../queryKeys.ts';

const POLL_MS = 3000;

interface Watcher {
  ports?: ListeningPort[];
  error?: string;
}

const watchers = new Map<string, Watcher>();
const watched = new Map<string, { cwd: string; users: number }>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let isPollQueued = false;

/**
 * Listening ports under the thread's cwd, polled while something on screen uses them; the last result stays for `listeningPorts`.
 * One scan every 3s covers every watched thread.
 */
export function usePorts(threadId: string, cwd: string | null) {
  useEffect(() => {
    // A folderless chat has no processes of its own to list.
    if (!cwd) return;
    return watchPorts(threadId, cwd);
  }, [threadId, cwd]);
  const watcher = useSyncExternalStore(subscribe, () => (cwd ? watchers.get(threadId) : undefined));
  return { ports: watcher?.ports, error: watcher?.error };
}

/** Port → configuration name from `cwd`'s .claude/launch.json. */
export function useLaunchNames(cwd: string | null) {
  const targetsQuery = useQuery({ queryKey: queryKeys.ports.launchTargets(cwd), queryFn: () => host.ports.targets(cwd!), enabled: !!cwd });
  return new Map((targetsQuery.data ?? []).flatMap((t) => t.source === 'launch.json' && t.port ? [[t.port, t.name] as const] : []));
}

export function refreshPorts() {
  queuePoll();
}

/** Includes `threadId` in the shared 3s poll until the last caller's cleanup runs. */
export function watchPorts(threadId: string, cwd: string) {
  const watch = watched.get(threadId) ?? { cwd, users: 0 };
  watch.cwd = cwd;
  watched.set(threadId, watch);
  if (!watchers.has(threadId)) watchers.set(threadId, {});
  if (++watch.users === 1) queuePoll();
  timer ??= setInterval(() => void poll(), POLL_MS);
  return () => {
    if (--watch.users > 0) return;
    watched.delete(threadId);
    if (watched.size > 0) return;
    clearInterval(timer);
    timer = undefined;
  };
}

// Threads mounting in one commit each want a first result; a microtask folds them into one scan.
function queuePoll() {
  if (isPollQueued) return;
  isPollQueued = true;
  queueMicrotask(() => {
    isPollQueued = false;
    void poll();
  });
}

async function poll() {
  const threads = [...watched].map(([threadId, { cwd }]) => [threadId, cwd] as const);
  if (threads.length === 0) return;
  try {
    const found = await host.ports.list(threads.map(([, cwd]) => cwd));
    threads.forEach(([threadId], i) => record(threadId, found[i]));
  } catch (error) {
    for (const [threadId] of threads) watchers.set(threadId, { ...watchers.get(threadId), error: (error as Error).message });
  }
  listeners.forEach((listener) => listener());
}

function record(threadId: string, listing: PortsListing) {
  if ('error' in listing) return void watchers.set(threadId, { ...watchers.get(threadId), error: listing.error });
  recordListeningPorts(threadId, listing.ports);
  watchers.set(threadId, { ports: listing.ports });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
