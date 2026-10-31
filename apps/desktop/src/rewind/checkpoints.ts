import {
  isWorking,
  type ActivityEntry,
  type QueueItem,
  type Step,
  type Thread,
  type ThreadStatus,
} from '../model.ts';
import { statusAt } from '../progress.ts';
import { log, mapThread } from '../store/threads.ts';
import type { State } from '../store/types.ts';

/** The thread's transcript and steps at a step boundary, plus the commit holding its worktree's files once one was saved. */
export interface Checkpoint {
  n: number;
  at: number;
  label: string;
  stepId?: string;
  /** The thread then, less what `checkpointThread` takes from the live thread. */
  thread: CheckpointThread;
  /** How many of the live thread's `activity` entries and `subagents` it held: both only grow, and a rewind cuts them back. */
  activityCount: number;
  subagentCount: number;
  ref?: string;
  wantsFiles?: boolean;
  /** Saved just before your message at this activity index, so rewinding to it restores exactly the files it found. */
  before?: number;
}

/** Copying the transcript into every checkpoint grew the store with the square of a thread's length. */
export type CheckpointThread = Omit<
  Thread,
  'activity' | 'subagents' | 'agent' | 'setup'
>;

/** A thread as a checkpoint keeps it: what only grows becomes a count, what follows the session stays with the live thread. */
export function checkpointOf(
  thread: Thread,
): Pick<Checkpoint, 'thread' | 'activityCount' | 'subagentCount'> {
  const { activity, subagents, agent: _agent, setup: _setup, ...kept } = thread;
  return {
    thread: kept,
    activityCount: activity.length,
    subagentCount: subagents?.length ?? 0,
  };
}

/** The thread as it stood at `checkpoint`, rebuilt from `live`, the same thread now: its transcript and subagents cut back, its session current. */
export function checkpointThread(live: Thread, checkpoint: Checkpoint): Thread {
  return {
    ...checkpoint.thread,
    activity: live.activity.slice(0, checkpoint.activityCount),
    ...(live.subagents && {
      subagents: live.subagents.slice(0, checkpoint.subagentCount),
    }),
    agent: live.agent,
    setup: live.setup,
  };
}

/** `chat`: transcript, steps and the agent's session go back, files stay. `files`: the worktree goes back too. */
export type RewindMode = 'chat' | 'files';

export interface RewindUndo {
  threadId: string;
  thread: Thread;
  checkpoints: Checkpoint[];
  queue: QueueItem[];
  hasFiles: boolean;
}

/** Why a rewind can't run now, or undefined when it can. Rewinding under a working agent would race its edits and its session. */
export function rewindBlockedReason(thread: Thread) {
  return isWorking(thread) ? STOP_TO_REWIND : undefined;
}

export const STOP_TO_REWIND = 'Stop the agent to rewind';

/** The label inside a sentence: "Rewound to after "Charts page"". */
export function checkpointPhrase(checkpoint: Pick<Checkpoint, 'label'>) {
  return checkpoint.label[0].toLowerCase() + checkpoint.label.slice(1);
}

/** The checkpoint saved just before the message at activity index `start` (the thread's start for work before your first message), never a later one. */
export function turnCheckpoint(list: Checkpoint[], start: number) {
  return start < 0 ? list[0] : list.findLast((c) => c.before === start);
}

/** Latest checkpoint at or before `t`, else the first one. */
export function checkpointAt(list: Checkpoint[], t: number) {
  return list.findLast((c) => c.at <= t) ?? list[0];
}

/** Rebuilds the thread as it stood at `t` from its own history: steps added by then with their status then, activity up to `t`. */
export function threadAt(thread: Thread, t: number): Thread {
  const steps = thread.steps.flatMap((s): Step[] => {
    const status = statusAt(s, t);
    if (!status) return [];
    const isLater = (at?: number) => at !== undefined && at > t;
    const isStarted = !isLater(s.startedAt);
    const isDone = !isLater(s.doneAt);
    return [
      {
        ...s,
        status,
        startedAt: isStarted ? s.startedAt : undefined,
        startedMs: isStarted ? s.startedMs : undefined,
        doneAt: isDone ? s.doneAt : undefined,
        doneMs: isDone ? s.doneMs : undefined,
        ...(isLater(s.stoppedAt) && {
          stoppedAt: undefined,
          stoppedMs: undefined,
        }),
        droppedAt: isLater(s.droppedAt) ? undefined : s.droppedAt,
      },
    ];
  });
  return {
    ...thread,
    steps,
    status: statusFor(steps),
    settledAt: undefined,
    settledMs: undefined,
    activity: thread.activity.filter((a) => a.at <= t),
  };
}

function statusFor(steps: Step[]): ThreadStatus {
  if (steps.some((s) => s.status === 'blocked')) return 'needs-you';
  return steps.some((s) => s.status !== 'done' && s.status !== 'dropped')
    ? 'running'
    : 'review';
}

/** The start of the thread and every finished step, rebuilt from history. `wantsFiles` asks for the worktree to be saved too, for threads born while the app runs. */
export function seedCheckpoints(
  thread: Thread,
  firstN: number,
  wantsFiles = false,
): Checkpoint[] {
  const done = thread.steps
    .filter((s) => s.status === 'done' && s.doneAt !== undefined)
    .sort((a, b) => a.doneAt! - b.doneAt!);
  return [
    {
      n: firstN,
      at: thread.startedAt,
      label: 'Start',
      ...checkpointOf(threadAt(thread, thread.startedAt)),
      wantsFiles,
    },
    ...done.map((s, i) => ({
      n: firstN + i + 1,
      at: s.doneAt!,
      label: `After "${s.title}"`,
      stepId: s.id,
      ...checkpointOf(threadAt(thread, s.doneAt!)),
    })),
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
    const doneBefore = new Set(
      before?.steps.filter((s) => s.status === 'done').map((s) => s.id),
    );
    const finished = thread.steps.filter(
      (s) => s.status === 'done' && !doneBefore.has(s.id),
    );
    const sent = before ? yourNewMessages(before, thread) : [];
    if (finished.length === 0 && sent.length === 0) continue;
    const added = [
      ...sent.map((index): Checkpoint => ({
        n: seq++,
        at: next.now,
        label: `Before "${excerpt(thread.activity[index].text)}"`,
        before: index,
        ...checkpointOf({
          ...before!,
          activity: thread.activity.slice(0, index),
        }),
        wantsFiles: true,
      })),
      ...finished.map((s): Checkpoint => ({
        n: seq++,
        at: next.now,
        label: `After "${s.title}"`,
        stepId: s.id,
        ...checkpointOf(thread),
        wantsFiles: true,
      })),
    ];
    checkpoints = { ...checkpoints, [thread.id]: [...list, ...added] };
  }
  if (checkpoints === next.checkpoints) return next;
  return { ...next, checkpoints, checkpointSeq: seq };
}

/** Activity indexes of your messages that `next` added after `prev`'s transcript. */
function yourNewMessages(prev: Thread, next: Thread) {
  if (next.activity.length <= prev.activity.length) return [];
  return next.activity.flatMap((e, i) =>
    i >= prev.activity.length && isYourMessage(e) ? [i] : [],
  );
}

const isYourMessage = (e: ActivityEntry) =>
  e.who === 'you' && e.kind === 'message';

/** Puts the thread's steps and transcript back to checkpoint `n` and drops later checkpoints and queue items; one undo is kept. */
export function rewind(
  state: State,
  threadId: string,
  n: number,
  mode: RewindMode = 'files',
  forkAt?: string | null,
  ms?: number,
): State {
  const current = state.threads.find((t) => t.id === threadId);
  const list = state.checkpoints[threadId] ?? [];
  const index = list.findIndex((c) => c.n === n);
  if (!current || index < 0) return state;
  return restore(
    state,
    threadId,
    checkpointThread(current, list[index]),
    index,
    checkpointPhrase(list[index]),
    mode,
    forkAt,
    ms,
  );
}

/**
 * Back to just before the message at `index` in the thread's activity: the transcript stops before it, steps are rebuilt for that moment,
 * and the worktree's files come from the latest checkpoint at or before it (the closest saved files).
 */
export function rewindToMessage(
  state: State,
  threadId: string,
  index: number,
  mode: RewindMode = 'files',
  forkAt?: string | null,
  ms?: number,
): State {
  const current = state.threads.find((t) => t.id === threadId);
  const entry = current?.activity[index];
  const list = state.checkpoints[threadId] ?? [];
  if (!current || !entry || list.length === 0) return state;
  const cpIndex = list.indexOf(checkpointForMessage(state, threadId, index)!);
  // Times are whole minutes and a message often shares its minute with the step it added: rebuild from just before it. The transcript is cut by position.
  const before = {
    ...threadAt(current, entry.at - 0.001),
    activity: current.activity.slice(0, index),
  };
  return restore(
    state,
    threadId,
    before,
    cpIndex,
    `before "${excerpt(entry.text)}"`,
    mode,
    forkAt,
    ms,
  );
}

/** The point a message sits at for rewinding: the checkpoint saved just before it, else the latest one before it. */
export function checkpointForMessage(
  state: State,
  threadId: string,
  index: number,
) {
  const entry = state.threads.find((t) => t.id === threadId)?.activity[index];
  const list = state.checkpoints[threadId] ?? [];
  if (!entry || !list.length) return;
  // A message sent in the same minute as a later one: its own checkpoint, never the later message's.
  return (
    list.findLast((c) => c.before === index) ??
    checkpointAt(
      list.filter((c) => c.before === undefined || c.before < index),
      entry.at,
    )
  );
}

/** The first of your messages a rewind to `base` drops: the agent's session goes back to just before it. */
export function firstDroppedMessage(current: Thread, keptLength: number) {
  return current.activity.slice(keptLength).find(isYourMessage);
}

function restore(
  state: State,
  threadId: string,
  base: Thread,
  cpIndex: number,
  phrase: string,
  mode: RewindMode,
  forkAt?: string | null,
  ms?: number,
): State {
  const current = state.threads.find((t) => t.id === threadId);
  const list = state.checkpoints[threadId] ?? [];
  const cp = list[cpIndex];
  if (!current || !cp || rewindBlockedReason(current)) return state;
  const restored: Thread = {
    ...base,
    // Work resumes now: a step that was running at the checkpoint restarts its clock instead of claiming the hours since.
    steps: base.steps.map((s) =>
      s.status === 'running'
        ? {
            ...s,
            startedAt: state.now,
            startedMs: ms,
            stoppedAt: undefined,
            stoppedMs: undefined,
          }
        : s,
    ),
    title: current.title,
    line: current.line,
    orbitSlot: current.orbitSlot,
    providers: current.providers,
    session: current.session,
    live: current.live && liveAfterRewind(current, base, forkAt),
  };
  const hasFiles = mode === 'files' && !!cp.ref;
  const files = hasFiles ? 'files and transcript' : 'transcript';
  return {
    ...state,
    threads: mapThread(state.threads, threadId, () =>
      log(restored, {
        at: state.now,
        who: 'harness',
        kind: 'event',
        text: `Rewound ${files} to ${phrase}`,
      }),
    ),
    checkpoints: {
      ...state.checkpoints,
      [threadId]: list.slice(0, cpIndex + 1).map((c) => cutTo(c, restored)),
    },
    queue: state.queue.filter(
      (q) => q.threadId !== threadId || q.createdAt <= cp.at,
    ),
    rewindUndo: {
      threadId,
      thread: current,
      checkpoints: list,
      queue: state.queue.filter((q) => q.threadId === threadId),
      hasFiles,
    },
  };
}

/** A kept checkpoint never counts past the rewound thread: what follows its cut is new and isn't the checkpoint's. A message's rewind can keep a checkpoint from later in the same minute. */
function cutTo(checkpoint: Checkpoint, base: Thread): Checkpoint {
  const activityCount = Math.min(
    checkpoint.activityCount,
    base.activity.length,
  );
  const subagentCount = Math.min(
    checkpoint.subagentCount,
    base.subagents?.length ?? 0,
  );
  if (
    activityCount === checkpoint.activityCount &&
    subagentCount === checkpoint.subagentCount
  )
    return checkpoint;
  return { ...checkpoint, activityCount, subagentCount };
}

/**
 * The agent stops (`agentCalls`) and its next start continues a session cut where the transcript now ends: a fork at `forkAt`
 * when main knew the point, else a fresh session handed the transcript. A rewind that drops none of your messages keeps the session.
 */
function liveAfterRewind(
  current: Thread,
  base: Thread,
  forkAt?: string | null,
): Thread['live'] {
  const live = { ...current.live!, isWorking: false, isDetached: true };
  if (!firstDroppedMessage(current, base.activity.length)) return live;
  return {
    ...live,
    restart: forkAt ? { forkAt } : { seed: transcriptSeed(base.activity) },
  };
}

// The last 40 messages, 1500 chars each, keeps the seed under main's 100k prompt cap; a summary pass if long threads need more of their past.
const SEED_MESSAGES = 40;
const SEED_CHARS = 1500;

/** What a fresh session is told when its old one couldn't be cut at the rewind point. */
export function transcriptSeed(activity: ActivityEntry[]) {
  const messages = activity
    .filter((e) => e.kind === 'message')
    .slice(-SEED_MESSAGES);
  if (!messages.length) return '';
  const lines = messages.map(
    (e) =>
      `${e.who === 'you' ? 'User' : 'Assistant'}: ${e.text.length > SEED_CHARS ? `${e.text.slice(0, SEED_CHARS)}…` : e.text}`,
  );
  return `[The user rewound this conversation; your earlier session was replaced. The conversation so far:]\n\n${lines.join('\n\n')}\n\n[End of the earlier conversation. The user's new message follows.]`;
}

export function excerpt(text: string) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 40 ? `${line.slice(0, 39)}…` : line;
}

export function undoRewind(state: State): State {
  const undo = state.rewindUndo;
  const thread = state.threads.find((t) => t.id === undo?.threadId);
  if (!undo || (thread && rewindBlockedReason(thread))) return state;
  return {
    ...state,
    // The agent stops (`agentCalls`) and resumes the session it had: rewinds fork it, so the original is still whole.
    threads: mapThread(state.threads, undo.threadId, () =>
      log(
        {
          ...undo.thread,
          live: undo.thread.live && {
            ...undo.thread.live,
            isWorking: false,
            isDetached: true,
          },
        },
        {
          at: state.now,
          who: 'harness',
          kind: 'event',
          text: 'Undid the rewind',
        },
      ),
    ),
    checkpoints: { ...state.checkpoints, [undo.threadId]: undo.checkpoints },
    queue: [
      ...state.queue.filter((q) => q.threadId !== undo.threadId),
      ...undo.queue,
    ],
    rewindUndo: null,
  };
}

/** Logs a turn's file changes undone or put back. The `undo` file save now holds this undo's files, so a rewind's undo can no longer put its own back. */
export function turnUndo(
  state: State,
  threadId: string,
  turnUndo: NonNullable<ActivityEntry['turnUndo']>,
  text: string,
): State {
  return {
    ...state,
    threads: mapThread(state.threads, threadId, (t) =>
      log(t, { at: state.now, who: 'harness', kind: 'event', text, turnUndo }),
    ),
    rewindUndo:
      state.rewindUndo?.threadId === threadId && state.rewindUndo.hasFiles
        ? null
        : state.rewindUndo,
  };
}
