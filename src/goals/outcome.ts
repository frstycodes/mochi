import type { Thread } from '../model.ts';

/** What a settled goal came to. GAP: no cost yet, the tick simulation tracks tokens but not spend. */
export function outcomeOf(thread: Thread) {
  const end = thread.settledAt ?? Math.max(thread.startedAt, ...thread.activity.map((a) => a.at), ...thread.steps.map((s) => s.doneAt ?? s.droppedAt ?? 0));
  const done = thread.steps.filter((s) => s.status === 'done');
  const dropped = thread.steps.filter((s) => s.status === 'dropped');
  const open = thread.steps.length - done.length - dropped.length;
  return {
    minutes: Math.max(0, Math.round(end - thread.startedAt)),
    done: done.length,
    dropped: dropped.length,
    open,
    revisions: thread.revisions.length - 1,
    merged: thread.prs.filter((p) => p.state === 'merged'),
    unmerged: thread.prs.filter((p) => p.state !== 'merged'),
  };
}
