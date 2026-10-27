import type {
  ActivityEntry,
  QueueItem,
  QueuedMessage,
  Thread,
} from '../model.ts';
import { subThreadsOf } from '../reorder.ts';

// What is due for the reactor's rules (packages/core/src/reactor/rules.ts) and its window-side re-checks. No store imports:
// Core imports this.

type ReportEntry = ActivityEntry & {
  subReport: NonNullable<ActivityEntry['subReport']>;
};

/** The sub-thread reports and replies in a thread's transcript its agent hasn't had yet, oldest first. */
export const undeliveredReports = (thread: Pick<Thread, 'activity'>) =>
  thread.activity.filter(
    (e): e is ReportEntry => !!e.subReport && !e.subReport.isDelivered,
  );

/** The undelivered reports that can wake the agent: all but `no_change` ones, which wait for a message or another wake. */
export const wakingReports = (thread: Pick<Thread, 'activity'>) =>
  undeliveredReports(thread).filter((e) => !e.subReport.isQuiet);

/** The agent got its undelivered reports (with a message or a wake): they stay in the transcript, marked delivered. */
export function markReportsDelivered(thread: Thread): Thread {
  if (!undeliveredReports(thread).length) return thread;
  return {
    ...thread,
    activity: thread.activity.map((e) =>
      e.subReport && !e.subReport.isDelivered
        ? { ...e, subReport: { ...e.subReport, isDelivered: true } }
        : e,
    ),
  };
}

interface Threads {
  threads: ReadonlyArray<Thread>;
  queue: ReadonlyArray<QueueItem>;
}

/** The head of each live thread's queue whose agent is idle, not paused and not waiting on your answer. */
export function dueQueued(
  state: Threads,
): { thread: Thread; message: QueuedMessage }[] {
  return state.threads.flatMap((thread) => {
    const message = thread.queued?.[0];
    // A steer the agent hasn't read yet goes first: it will start the next turn if this one ended before reading it.
    if (
      !message ||
      !thread.live ||
      thread.queuePause ||
      thread.live.isWorking ||
      thread.live.starting ||
      thread.steering ||
      thread.status === 'settled'
    )
      return [];
    if (isWaitingOnYou(state, thread.id)) return [];
    return [{ thread, message }];
  });
}

/** Delegated tasks that ended on their own and whose report hasn't gone to their thread's agent yet. */
export function dueReports(threads: ReadonlyArray<Thread>) {
  return threads.flatMap((thread) =>
    thread.live
      ? (thread.subagents ?? [])
          .filter((s) => s.isReportDue)
          .map((subagent) => ({ thread, subagent }))
      : [],
  );
}

/**
 * Threads holding sub-thread reports or replies that nothing else will deliver: idle, nothing queued or waiting on you, and every
 * sub-thread idle, so done reports batch. An urgent report (blocked, needs_input, failed) doesn't wait for the other sub-threads;
 * a quiet one (no_change) never wakes it, but goes out with the wake.
 */
export function dueWakes(state: Threads): Thread[] {
  return state.threads.filter((t) => {
    if (
      !t.live ||
      t.live.isWorking ||
      t.live.starting ||
      t.status === 'settled' ||
      t.queued?.length
    )
      return false;
    const reports = wakingReports(t);
    if (!reports.length) return false;
    if (isWaitingOnYou(state, t.id)) return false;
    if (reports.some((e) => e.subReport.isUrgent)) return true;
    return !subThreadsOf([...state.threads], t.id).some(
      (s) => s.live?.isWorking || s.live?.starting,
    );
  });
}

const isWaitingOnYou = (state: Threads, threadId: string) =>
  state.queue.some(
    (q) =>
      q.threadId === threadId &&
      (q.kind === 'approval' || q.kind === 'question'),
  );
