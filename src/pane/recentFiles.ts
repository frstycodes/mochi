import { useMemo, useSyncExternalStore } from 'react';
import type { ActivityEntry, Thread } from '../model.ts';
import { parseTool } from '../summary.ts';

export interface RecentFile {
  path: string;
  at: number;
}

const FILE_VERBS = ['Read', 'Edit', 'Write'];
const EMPTY: RecentFile[] = [];

/** Files the agent touched (work log Read / Edit / Write) and files opened in a Files tab, newest first, each once, relative to `root`. */
export function recentFiles(activity: ActivityEntry[], opened: RecentFile[], root: string, limit = 8): RecentFile[] {
  const touched = activity.flatMap((e) => {
    if (e.kind !== 'tool') return [];
    const call = parseTool(e.text);
    return FILE_VERBS.includes(call.verb) && call.target ? [{ path: call.target, at: e.at }] : [];
  });
  const prefix = root.endsWith('/') ? root : `${root}/`;
  const seen = new Set<string>();
  return [...touched, ...opened]
    .map((f) => ({ ...f, path: (f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path).replace(/:\d+(:\d+)?$/, '') }))
    .sort((a, b) => b.at - a.at)
    .filter((f) => !seen.has(f.path) && !!seen.add(f.path))
    .slice(0, limit);
}

// GAP: in memory only, so files opened in a Files tab drop off the empty pane's list after a reload; the work log's files stay.
const opened = new Map<string, RecentFile[]>();
const listeners = new Set<() => void>();

export function noteOpened(threadId: string, path: string) {
  opened.set(threadId, [{ path, at: Date.now() }, ...(opened.get(threadId) ?? []).filter((f) => f.path !== path)]);
  listeners.forEach((l) => l());
}

export function useRecentFiles(thread: Thread, root: string) {
  const opened = useOpenedFiles(thread.id);
  return useMemo(() => recentFiles(thread.activity, opened, root), [thread.activity, opened, root]);
}

function useOpenedFiles(threadId: string) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => opened.get(threadId) ?? EMPTY,
  );
}
