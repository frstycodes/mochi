import type { QueueItem, Thread } from '../model.ts';
import type { State } from '../store/index.tsx';
import { summarize } from '../summary.ts';

/** Files the thread's agent edited or wrote, relative to its own worktree so two worktrees of one repo compare. */
export function editedFiles(t: Thread) {
  const root = t.live?.cwd?.replace(/\/$/, '');
  return new Set(summarize(t.activity).files.map((f) => (root && f.path.startsWith(`${root}/`) ? f.path.slice(root.length + 1) : f.path)));
}

/**
 * After `threadId` edits: one Queue item per pair of unsettled threads in the same project whose edits share a file.
 * Never pauses either agent; you decide whether to step in.
 */
export function noteCollisions(state: State, threadId: string): State {
  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread?.repo || thread.status === 'settled') return state;
  const mine = editedFiles(thread);
  if (!mine.size) return state;
  const items: QueueItem[] = [];
  for (const other of state.threads) {
    if (other.id === thread.id || other.status === 'settled' || other.spaceId !== thread.spaceId || other.repo?.project !== thread.repo.project) continue;
    const id = `q-collision-${[thread.id, other.id].sort().join('-')}`;
    if (state.queue.some((q) => q.id === id)) continue;
    const files = [...editedFiles(other)].filter((f) => mine.has(f));
    if (!files.length) continue;
    items.push({ id, kind: 'collision', threadId: thread.id, title: `"${other.title}" is editing the same ${files.length === 1 ? 'file' : 'files'}`, detail: '', blocks: { steps: 0, threads: 2 }, createdAt: state.now, collision: { otherThreadId: other.id, files } });
  }
  return items.length ? { ...state, queue: [...state.queue, ...items] } : state;
}
