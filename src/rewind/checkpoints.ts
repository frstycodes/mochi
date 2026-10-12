import type { QueueItem, Step, Thread, ThreadStatus } from '../model.ts';
import { statusAt } from '../progress.ts';
import { log, mapThread } from '../store/threads.ts';
import type { State } from '../store/index.tsx';

/** The thread's transcript and steps at a step boundary, plus the commit holding its worktree's files once one was saved. */
export interface Checkpoint {
  n: number;
  at: number;
  label: string;
  stepId?: string;
  thread: Thread;
  ref?: string;
  wantsFiles?: boolean;
}

export interface RewindUndo {
  threadId: string;
  thread: Thread;
  checkpoints: Checkpoint[];
  queue: QueueItem[];
  hasFiles: boolean;
}

/** The label inside a sentence: "Rewound to after "Charts page"". */
export function checkpointPhrase(checkpoint: Pick<Checkpoint, 'label'>) {
  return checkpoint.label[0].toLowerCase() + checkpoint.label.slice(1);
}

/** Latest checkpoint at or before `t`, else the first one. */
export function checkpointAt(list: Checkpoint[], t: number) {
  return list.findLast((c) => c.at <= t) ?? list[0];
}

/** Rebuilds the thread as it stood at `t` from its own history: steps added by then with their status then, activity and revisions up to `t`. */
export function threadAt(thread: Thread, t: number): Thread {
  const steps = thread.steps.flatMap((s): Step[] => {
    const status = statusAt(s, t);
    if (!status) return [];
    const isLater = (at?: number) => at !== undefined && at > t;
    return [{ ...s, status, progress: progressAt(s, status, t), startedAt: isLater(s.startedAt) ? undefined : s.startedAt, doneAt: isLater(s.doneAt) ? undefined : s.doneAt, droppedAt: isLater(s.droppedAt) ? undefined : s.droppedAt }];
  });
  return {
    ...thread,
    steps,
    status: statusFor(steps),
    settledAt: undefined,
    activity: thread.activity.filter((a) => a.at <= t),
    revisions: thread.revisions.filter((r) => r.at <= t),
  };
}

function progressAt(step: Step, status: Step['status'], t: number) {
  if (status === 'done') return 1;
  if (status !== 'running' || step.startedAt === undefined) return 0;
  if (step.doneAt === undefined) return step.progress;
  return Math.min(0.99, (t - step.startedAt) / Math.max(1, step.doneAt - step.startedAt));
}

function statusFor(steps: Step[]): ThreadStatus {
  if (steps.some((s) => s.status === 'blocked')) return 'needs-you';
  return steps.some((s) => s.status !== 'done' && s.status !== 'dropped') ? 'running' : 'review';
}

/** The start of the thread and every finished step, rebuilt from history. `wantsFiles` asks for the worktree to be saved too, for threads born while the app runs. */
export function seedCheckpoints(thread: Thread, firstN: number, wantsFiles = false): Checkpoint[] {
  const done = thread.steps.filter((s) => s.status === 'done' && s.doneAt !== undefined).sort((a, b) => a.doneAt! - b.doneAt!);
  return [
    { n: firstN, at: thread.startedAt, label: 'Start', thread: threadAt(thread, thread.startedAt), wantsFiles },
    ...done.map((s, i) => ({ n: firstN + i + 1, at: s.doneAt!, label: `After "${s.title}"`, stepId: s.id, thread: threadAt(thread, s.doneAt!) })),
  ];
}

/** After any reducer step: seed threads seen for the first time and record a checkpoint per newly finished step. */
export function recordCheckpoints(prev: State, next: State): State {
  let seq = next.checkpointSeq;
  let checkpoints = next.checkpoints;
  for (const thread of next.threads) {
    const before = prev.threads.find((t) => t.id === thread.id);
    if (before === thread) continue;
    const list = checkpoints[thread.id];
    if (!list) {
      const seeded = seedCheckpoints(thread, seq, true);
      seq += seeded.length;
      checkpoints = { ...checkpoints, [thread.id]: seeded };
      continue;
    }
    const doneBefore = new Set(before?.steps.filter((s) => s.status === 'done').map((s) => s.id));
    const finished = thread.steps.filter((s) => s.status === 'done' && !doneBefore.has(s.id));
    if (finished.length === 0) continue;
    const added = finished.map((s) => ({ n: seq++, at: next.now, label: `After "${s.title}"`, stepId: s.id, thread, wantsFiles: true }));
    checkpoints = { ...checkpoints, [thread.id]: [...list, ...added] };
  }
  if (checkpoints === next.checkpoints) return next;
  return { ...next, checkpoints, checkpointSeq: seq };
}

/** Puts the thread's steps, transcript and goal back to checkpoint `n` and drops later checkpoints and queue items; one undo is kept. */
export function rewind(state: State, threadId: string, n: number): State {
  const list = state.checkpoints[threadId] ?? [];
  const index = list.findIndex((c) => c.n === n);
  if (index < 0) return state;
  return restore(state, threadId, list[index].thread, index, checkpointPhrase(list[index]));
}

/**
 * Back to just before the message at `index` in the thread's activity: the transcript stops before it, steps and goal are rebuilt for that moment,
 * and the worktree's files come from the latest checkpoint at or before it (the closest saved files).
 */
export function rewindToMessage(state: State, threadId: string, index: number): State {
  const current = state.threads.find((t) => t.id === threadId);
  const entry = current?.activity[index];
  const list = state.checkpoints[threadId] ?? [];
  if (!current || !entry || list.length === 0) return state;
  const cpIndex = list.indexOf(checkpointAt(list, entry.at));
  // Times are whole minutes and a message often shares its minute with the step it added: rebuild from just before it. The transcript is cut by position.
  const before = { ...threadAt(current, entry.at - 0.001), activity: current.activity.slice(0, index) };
  return restore(state, threadId, before, cpIndex, `before "${excerpt(entry.text)}"`);
}

/** The point a message sits at for rewinding: its files come from this checkpoint. */
export function checkpointForMessage(state: State, threadId: string, index: number) {
  const entry = state.threads.find((t) => t.id === threadId)?.activity[index];
  const list = state.checkpoints[threadId] ?? [];
  return entry && list.length ? checkpointAt(list, entry.at) : undefined;
}

function restore(state: State, threadId: string, base: Thread, cpIndex: number, phrase: string): State {
  const current = state.threads.find((t) => t.id === threadId);
  const list = state.checkpoints[threadId] ?? [];
  const cp = list[cpIndex];
  if (!current || !cp) return state;
  const revision = base.revisions.length + 1;
  const restored: Thread = {
    ...base,
    // Work resumes now: a step that was running at the checkpoint restarts its clock instead of claiming the hours since.
    steps: base.steps.map((s) => (s.status === 'running' ? { ...s, startedAt: state.now } : s)),
    title: current.title,
    line: current.line,
    orbitSlot: current.orbitSlot,
    providers: current.providers,
    revisions: [...base.revisions, { n: revision, at: state.now, label: `Rewound to ${phrase}`, by: 'you', diff: rewindDiff(current, base) }],
  };
  const files = cp.ref ? 'files and transcript' : 'transcript';
  return {
    ...state,
    threads: mapThread(state.threads, threadId, () => log(restored, { at: state.now, who: 'harness', kind: 'event', text: `Rewound ${files} to ${phrase}` })),
    checkpoints: { ...state.checkpoints, [threadId]: list.slice(0, cpIndex + 1) },
    queue: state.queue.filter((q) => q.threadId !== threadId || q.createdAt <= cp.at),
    rewindUndo: { threadId, thread: current, checkpoints: list, queue: state.queue.filter((q) => q.threadId === threadId), hasFiles: !!cp.ref },
  };
}

function excerpt(text: string) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 40 ? `${line.slice(0, 39)}…` : line;
}

function rewindDiff(from: Thread, to: Thread) {
  const kept = new Set(to.steps.map((s) => s.id));
  const removed = from.steps.filter((s) => !kept.has(s.id)).map((s) => `− ${s.title}`);
  const reopened = to.steps.filter((s) => s.status !== 'done' && from.steps.find((f) => f.id === s.id)?.status === 'done').map((s) => `~ Reopened "${s.title}"`);
  return [...removed, ...reopened];
}

export function undoRewind(state: State): State {
  const undo = state.rewindUndo;
  if (!undo) return state;
  return {
    ...state,
    threads: mapThread(state.threads, undo.threadId, () => log(undo.thread, { at: state.now, who: 'harness', kind: 'event', text: 'Undid the rewind' })),
    checkpoints: { ...state.checkpoints, [undo.threadId]: undo.checkpoints },
    queue: [...state.queue.filter((q) => q.threadId !== undo.threadId), ...undo.queue],
    rewindUndo: null,
  };
}
