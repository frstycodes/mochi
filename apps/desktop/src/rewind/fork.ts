import type { Thread } from '../model.ts';
import { freeLine, log, mapThread } from '../store/threads.ts';
import type { State } from '../store/types.ts';
import { checkpointAt, threadAt, type Checkpoint } from './checkpoints.ts';

export type ForkPoint =
  | { kind: 'message'; index: number }
  | { kind: 'checkpoint'; n: number };

/** Where a fork came from. `checkpoint` names the parent's checkpoint whose files seed the fork's worktree. */
export interface Fork {
  parentId: string;
  at: number;
  label: string;
  checkpoint?: number;
}

/** A new thread carrying the parent's goal, steps and transcript up to `point`, on its own branch; opened right away. */
export function forkThread(
  state: State,
  threadId: string,
  point: ForkPoint,
): State {
  const parent = state.threads.find((t) => t.id === threadId);
  const from =
    parent && forkSource(parent, state.checkpoints[threadId] ?? [], point);
  if (!parent || !from) return state;
  const now = state.now;
  const id = `fork-${state.seq}`;
  const base = from.thread;
  const revision = base.revisions.length + 1;
  const child: Thread = {
    ...base,
    id,
    title: `${parent.title} (fork)`,
    // A fork always gets a worktree of its own, even off a project folder thread.
    repo: parent.repo && {
      ...parent.repo,
      branch: `${parent.repo.branch}-fork-${state.seq}`,
      mode: undefined,
      isExisting: undefined,
    },
    line: freeLine(state.threads.filter((t) => t.spaceId === parent.spaceId)),
    orbitSlot: undefined,
    status: base.status === 'settled' ? 'running' : base.status,
    prs: [],
    steps: base.steps.map((s) => ({ ...s, id: `${s.id}-f${state.seq}` })),
    revisions: [
      ...base.revisions,
      {
        n: revision,
        at: now,
        label: `Forked from "${parent.title}"`,
        by: 'you',
      },
    ],
    activity: [
      ...base.activity,
      {
        at: now,
        who: 'harness',
        kind: 'event',
        text: `Forked from "${parent.title}" at ${from.label}`,
      },
    ],
  };
  const fork: Fork = {
    parentId: parent.id,
    at: from.at,
    label: from.label,
    checkpoint: from.checkpoint?.ref ? from.checkpoint.n : undefined,
  };
  const start: Checkpoint = {
    n: state.checkpointSeq,
    at: now,
    label: 'Fork point',
    thread: child,
    wantsFiles: true,
  };
  const threads = mapThread(state.threads, parent.id, (t) =>
    log(t, {
      at: now,
      who: 'harness',
      kind: 'event',
      text: `Forked to "${child.title}" at ${from.label}`,
    }),
  );
  const index = threads.findIndex((t) => t.id === parent.id);
  return {
    ...state,
    threads: [
      ...threads.slice(0, index + 1),
      child,
      ...threads.slice(index + 1),
    ],
    forks: { ...state.forks, [id]: fork },
    checkpoints: { ...state.checkpoints, [id]: [start] },
    checkpointSeq: state.checkpointSeq + 1,
    seq: state.seq + 1,
  };
}

function forkSource(
  parent: Thread,
  checkpoints: Checkpoint[],
  point: ForkPoint,
) {
  if (point.kind === 'checkpoint') {
    const checkpoint = checkpoints.find((c) => c.n === point.n);
    return (
      checkpoint && {
        thread: checkpoint.thread,
        at: checkpoint.at,
        label: checkpoint.label,
        checkpoint,
      }
    );
  }
  const entry = parent.activity[point.index];
  if (!entry) return null;
  const thread = {
    ...threadAt(parent, entry.at),
    activity: parent.activity.slice(0, point.index + 1),
  };
  return {
    thread,
    at: entry.at,
    label: `"${short(entry.text)}"`,
    checkpoint: checkpointAt(checkpoints, entry.at),
  };
}

/** Keeps one side of a fork; the other settles, so its worktree shows up in "clean up settled worktrees". */
export function keepFork(state: State, keepId: string, dropId: string): State {
  const keep = state.threads.find((t) => t.id === keepId);
  const drop = state.threads.find((t) => t.id === dropId);
  if (!keep || !drop || keepId === dropId) return state;
  const now = state.now;
  let threads = mapThread(state.threads, dropId, (t) =>
    log(
      { ...t, status: 'settled', settledAt: now },
      {
        at: now,
        who: 'harness',
        kind: 'event',
        text: `Settled: you kept "${keep.title}"`,
      },
    ),
  );
  threads = mapThread(threads, keepId, (t) =>
    log(t, {
      at: now,
      who: 'harness',
      kind: 'event',
      text: `Kept over "${drop.title}", which settled`,
    }),
  );
  return {
    ...state,
    threads,
    queue: state.queue.filter((q) => q.threadId !== dropId),
  };
}

/** Open threads on the same fork tree as `threadId`: its parent, its forks and its siblings. */
export function forkRelatives(
  state: Pick<State, 'threads' | 'forks'>,
  threadId: string,
): Thread[] {
  const parentId = state.forks[threadId]?.parentId;
  const ids = new Set(
    Object.entries(state.forks).flatMap(([child, f]) =>
      f.parentId === threadId || (parentId && f.parentId === parentId)
        ? [child]
        : [],
    ),
  );
  if (parentId) ids.add(parentId);
  ids.delete(threadId);
  return state.threads.filter((t) => ids.has(t.id) && t.status !== 'settled');
}

function short(text: string) {
  const line = text.split('\n')[0];
  return line.length > 40 ? `${line.slice(0, 39)}…` : line;
}
