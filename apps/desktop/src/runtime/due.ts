import { SUB_THREAD_STATUSES } from '@mochi/domain/runtime/toolTable';
import type {
  QueueItem,
  QueuedMessage,
  SubThreadStatus,
  Thread,
} from '../model.ts';
import { subThreadsOf } from '../reorder.ts';

// What is due for the reactor's rules (packages/core/src/reactor/rules.ts) and its window-side re-checks. No store imports:
// Core imports this.

export const NOTE_PREFIX = '[Sub-thread ';

/** A note from a thread this one messaged with `expectReply` (`noteReplies`). */
export const REPLY_PREFIX = '[Reply from thread ';

/** How a `report_to_parent` note opens; anything but done makes it urgent (`isUrgentNote`). */
export const reportHeader = (
  sub: Pick<Thread, 'id' | 'title'>,
  status: SubThreadStatus,
) => `${NOTE_PREFIX}"${sub.title}" (${sub.id}) reported: ${status}]`;

const URGENT_ENDS = SUB_THREAD_STATUSES.filter((s) => s !== 'done').map(
  (s) => ` reported: ${s}]`,
);

/** A note that wakes its parent at once, while other sub-threads still work: a report of blocked, needs_input or failed. */
export const isUrgentNote = (note: string) =>
  note.startsWith(NOTE_PREFIX) &&
  URGENT_ENDS.some((end) => note.split('\n', 1)[0].endsWith(end));

const isWakeNote = (note: string) =>
  note.startsWith(NOTE_PREFIX) || note.startsWith(REPLY_PREFIX);

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
 * Threads holding sub-thread or reply notes that nothing else will deliver: idle, nothing queued or waiting on you, and every
 * sub-thread idle, so done reports batch. An urgent note (`isUrgentNote`) doesn't wait for the other sub-threads.
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
    const notes = t.live.notes ?? [];
    if (!notes.some(isWakeNote)) return false;
    if (isWaitingOnYou(state, t.id)) return false;
    if (notes.some(isUrgentNote)) return true;
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
