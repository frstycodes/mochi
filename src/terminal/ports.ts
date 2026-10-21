import { useEffect, useState, useSyncExternalStore } from 'react';
import { host } from '../host/index.ts';
import type { ListeningPort } from '../host/types/ports.ts';
import { recordListeningPorts } from './devServer.ts';

const POLL_MS = 3000;

interface Watcher {
  ports?: ListeningPort[];
  error?: string;
}

const watchers = new Map<string, Watcher>();
const polls = new Map<string, { timer: ReturnType<typeof setInterval>; users: number }>();
const listeners = new Set<() => void>();

/**
 * Listening ports under the thread's cwd, polled while something on screen uses them; the last result stays for `listeningPorts`.
 * GAP: one lsof per mounted thread every 3s; move to a single main-process poller pushing events if many threads stay mounted.
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
  const [names, setNames] = useState(new Map<number, string>());
  useEffect(() => {
    if (!cwd) return;
    void host.ports.targets(cwd).then(
      (targets) => setNames(new Map(targets.flatMap((t) => (t.source === 'launch.json' && t.port ? [[t.port, t.name] as const] : [])))),
      () => setNames(new Map()),
    );
  }, [cwd]);
  return names;
}

export function refreshPorts(threadId: string, cwd: string) {
  void poll(threadId, cwd);
}

/** Polls `threadId` every 3s until the last caller's cleanup runs. */
export function watchPorts(threadId: string, cwd: string) {
  const watch = polls.get(threadId) ?? startPolling(threadId, cwd);
  watch.users++;
  return () => {
    if (--watch.users > 0) return;
    clearInterval(watch.timer);
    polls.delete(threadId);
  };
}

function startPolling(threadId: string, cwd: string) {
  if (!watchers.has(threadId)) watchers.set(threadId, {});
  void poll(threadId, cwd);
  const watch = { timer: setInterval(() => void poll(threadId, cwd), POLL_MS), users: 0 };
  polls.set(threadId, watch);
  return watch;
}

async function poll(threadId: string, cwd: string) {
  const watcher = watchers.get(threadId)!;
  try {
    const ports = await host.ports.list(cwd);
    recordListeningPorts(threadId, ports);
    watchers.set(threadId, { ...watcher, ports, error: undefined });
  } catch (error) {
    watchers.set(threadId, { ...watcher, error: (error as Error).message });
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
