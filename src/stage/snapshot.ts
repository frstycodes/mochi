import { useLatest } from '../useLatest.ts';
import { useQueries } from '@tanstack/react-query';
import type { Author, LineSlot, Thread, ThreadStatus } from '../model';
import { goalProgress } from '../progress';
import { isWorking } from '../agentPhase';
import { threadDetail } from '../threadRow';
import { useHarness, type State } from '../store';
import { queryKeys } from '../queryKeys';

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
  const latest = useLatest(state);
  const snapshotsQueries = useQueries({ queries: ids.map((id) => ({
    queryKey: queryKeys.stage.threadSnapshot(id),
    queryFn: () => { const thread = latest.current.threads.find((t) => t.id === id); return thread ? snapshotOf(thread, latest.current) : null; },
    staleTime: REFRESH_MS, refetchInterval: REFRESH_MS,
  })) });
  return snapshotsQueries.flatMap((result) => result.data ? [result.data] : []);
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

