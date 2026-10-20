import { useEffect, useState, useSyncExternalStore } from 'react';
import { host } from '../host';
import type { ListeningPort } from '../host/types/ports';
import { recordListeningPorts } from './devServer';

const POLL_MS = 3000;

interface Watcher {
  ports?: ListeningPort[];
  error?: string;
}

const watchers = new Map<string, Watcher>();
const listeners = new Set<() => void>();

/**
 * Listening ports under the thread's cwd. Polling starts on first use and keeps going after the tab unmounts.
 * GAP: one lsof per watched thread every 3s; move to a single main-process poller pushing events if many threads get watched.
 */
export function usePorts(threadId: string, cwd: string | null) {
  useEffect(() => {
    // A folderless chat has no processes of its own to list.
    if (!cwd || watchers.has(threadId)) return;
    startWatcher(threadId, cwd);
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

function startWatcher(threadId: string, cwd: string) {
  watchers.set(threadId, {});
  void poll(threadId, cwd);
  setInterval(() => void poll(threadId, cwd), POLL_MS);
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
