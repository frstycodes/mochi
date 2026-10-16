import { useEffect, useSyncExternalStore } from 'react';
import { toast } from '../toast/store.ts';
import { host } from '../host';
import type { ListeningPort } from '../host/types/ports';
import { recordListeningPorts } from './devServer';

const POLL_MS = 3000;

interface Watcher {
  ports?: ListeningPort[];
  error?: string;
  seen?: Set<number>;
  openPreview: (port: number) => void;
}

const watchers = new Map<string, Watcher>();
const listeners = new Set<() => void>();

/**
 * Listening ports under the thread's cwd. Polling starts on first use and keeps going after the tab unmounts, so the
 * "is up" toast still fires while the user watches the terminal.
 * GAP: one lsof per watched thread every 3s; move to a single main-process poller pushing events if many threads get watched.
 */
export function usePorts(threadId: string, cwd: string | null, openPreview: (port: number) => void) {
  useEffect(() => {
    // A folderless chat has no processes of its own to list.
    if (!cwd) return;
    const watcher = watchers.get(threadId);
    if (watcher) watcher.openPreview = openPreview;
    else startWatcher(threadId, cwd, openPreview);
  }, [threadId, cwd, openPreview]);
  const watcher = useSyncExternalStore(subscribe, () => (cwd ? watchers.get(threadId) : undefined));
  return { ports: watcher?.ports, error: watcher?.error };
}

export function refreshPorts(threadId: string, cwd: string) {
  void poll(threadId, cwd);
}

function startWatcher(threadId: string, cwd: string, openPreview: (port: number) => void) {
  watchers.set(threadId, { openPreview });
  void poll(threadId, cwd);
  setInterval(() => void poll(threadId, cwd), POLL_MS);
}

async function poll(threadId: string, cwd: string) {
  const watcher = watchers.get(threadId)!;
  try {
    const ports = await host.ports.list(cwd);
    // The first poll is the baseline: servers already running when the app opened don't toast.
    if (watcher.seen) for (const { port } of ports.filter((p) => !watcher.seen!.has(p.port))) announce(watcher, port);
    watcher.seen = new Set(ports.map((p) => p.port));
    recordListeningPorts(threadId, ports);
    watchers.set(threadId, { ...watcher, ports, error: undefined });
  } catch (error) {
    watchers.set(threadId, { ...watcher, error: (error as Error).message });
  }
  listeners.forEach((listener) => listener());
}

function announce(watcher: Watcher, port: number) {
  toast(`localhost:${port} is up`, { duration: 10_000, action: { label: 'Open preview', onClick: () => watcher.openPreview(port) } });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
