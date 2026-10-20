import { useRef } from 'react';
import type { Author, LineSlot, Thread, ThreadStatus } from '../model';
import { goalProgress } from '../progress';
import { isWorking } from '../agentPhase';
import { threadDetail } from '../threadRow';
import { useHarness, type State } from '../store';

/** What an overview card shows: plain data, so cards never mount a thread's live React tree. */
export interface ThreadSnapshot {
  id: string;
  title: string;
  line: LineSlot;
  status: ThreadStatus;
  met: number;
  total: number;
  nowStep: string;
  isWorking: boolean;
  lastMessage: { who: Author; text: string } | null;
  preview: { tabId: string; url: string } | null;
}

const REFRESH_MS = 1000;

/** Snapshots for `ids`, each refreshed at most once a second and kept identical while nothing on it changed, so memoized cards skip re-rendering. */
export function useThreadSnapshots(ids: string[]) {
  const { state } = useHarness();
  const cache = useRef(new Map<string, { at: number; snap: ThreadSnapshot }>());
  const t = performance.now();
  return ids.flatMap((id) => {
    const hit = cache.current.get(id);
    if (hit && t - hit.at < REFRESH_MS) return [hit.snap];
    const thread = state.threads.find((x) => x.id === id);
    if (!thread) return [];
    const next = snapshotOf(thread, state);
    const snap = hit && isSame(hit.snap, next) ? hit.snap : next;
    cache.current.set(id, { at: t, snap });
    return [snap];
  });
}

function snapshotOf(thread: Thread, state: State): ThreadSnapshot {
  const last = thread.activity.findLast((a) => a.kind === 'message');
  const tab = state.panes.find((p) => p.threadId === thread.id)?.tabs.find((t) => t.kind === 'browser');
  const { met, total } = goalProgress(thread);
  return {
    id: thread.id,
    title: thread.title,
    line: thread.line,
    status: thread.status,
    met,
    total,
    nowStep: threadDetail(thread, state.queue.find((q) => q.threadId === thread.id)?.title),
    isWorking: isWorking(thread),
    lastMessage: last ? { who: last.who, text: last.text } : null,
    preview: tab ? { tabId: tab.id, url: tab.url ?? '' } : null,
  };
}

function isSame(a: ThreadSnapshot, b: ThreadSnapshot) {
  return JSON.stringify(a) === JSON.stringify(b);
}
