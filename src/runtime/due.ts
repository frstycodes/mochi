import type { QueueItem, QueuedMessage, Thread } from '../model.ts';
import { subThreadsOf } from '../reorder.ts';

// What is due for the reactor's rules (packages/core/src/reactor/rules.ts) and its window-side re-checks. No store imports:
// Core imports this.

export const NOTE_PREFIX = '[Sub-thread ';

interface Threads {
  threads: ReadonlyArray<Thread>;
  queue: ReadonlyArray<QueueItem>;
}

/** The head of each live thread's queue whose agent is idle, not paused and not waiting on your answer. */
export function dueQueued(state: Threads): { thread: Thread; message: QueuedMessage }[] {
  return state.threads.flatMap((thread) => {
    const message = thread.queued?.[0];
    // A steer the agent hasn't read yet goes first: it will start the next turn if this one ended before reading it.
    if (!message || !thread.live || thread.queuePause || thread.live.isWorking || thread.live.starting || thread.steering || thread.status === 'settled') return [];
    if (isWaitingOnYou(state, thread.id)) return [];
    return [{ thread, message }];
  });
}

/** Delegated tasks that ended on their own and whose report hasn't gone to their thread's agent yet. */
export function dueReports(threads: ReadonlyArray<Thread>) {
  return threads.flatMap((thread) => (thread.live ? (thread.subagents ?? []).filter((s) => s.isReportDue).map((subagent) => ({ thread, subagent })) : []));
}

/** Parents holding sub-thread notes that nothing else will deliver: idle, nothing queued or waiting on you, and every sub-thread idle. */
export function dueWakes(state: Threads): Thread[] {
  return state.threads.filter((t) => {
    if (!t.live || t.live.isWorking || t.live.starting || t.status === 'settled' || t.queued?.length) return false;
    if (!t.live.notes?.some((n) => n.startsWith(NOTE_PREFIX))) return false;
    if (isWaitingOnYou(state, t.id)) return false;
    return !subThreadsOf([...state.threads], t.id).some((s) => s.live?.isWorking || s.live?.starting);
  });
}

const isWaitingOnYou = (state: Threads, threadId: string) => state.queue.some((q) => q.threadId === threadId && (q.kind === 'approval' || q.kind === 'question'));
