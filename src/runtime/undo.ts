import type { Thread } from '../model.ts';
import type { State } from '../store/types.ts';

const SLICES = ['queue', 'panes', 'layouts', 'watched'] as const;

type Slices = Pick<State, 'threads' | (typeof SLICES)[number]>;

/** What a Mochi tool call changed, for its Undo toast. */
export interface ToolUndo {
  before: Slices;
  after: Slices;
}

export function captureUndo(before: State, after: State): ToolUndo | null {
  const pick = (s: State): Slices => ({ threads: s.threads, queue: s.queue, panes: s.panes, layouts: s.layouts, watched: s.watched });
  const changed = before.threads !== after.threads || SLICES.some((k) => before[k] !== after[k]);
  return changed ? { before: pick(before), after: pick(after) } : null;
}

/**
 * Puts back what the call changed, field by field, wherever it still holds the call's result: a thread whose title you
 * renamed since keeps your title, an agent's later activity stays. Activity is never rolled back. `kept` counts what changed since.
 */
export function applyUndo(state: State, { before, after }: ToolUndo): { state: State; kept: number } {
  let kept = 0;
  const was = new Map(before.threads.map((t) => [t.id, t]));
  const did = new Map(after.threads.map((t) => [t.id, t]));
  const threads = state.threads.flatMap((current): Thread[] => {
    const b = was.get(current.id);
    const a = did.get(current.id);
    if (!a || a === b) return [current];
    // Created by the call: gone again, unless something has happened in it since.
    if (!b) return current === a ? [] : (kept++, [current]);
    const restored = { ...current };
    for (const key of Object.keys({ ...a, ...b }) as (keyof Thread)[]) {
      if (key === 'activity' || a[key] === b[key]) continue;
      if (current[key] !== a[key]) kept++;
      else Object.assign(restored, { [key]: b[key] });
    }
    return [restored];
  });
  const order = (list: Thread[]) => list.map((t) => t.id).join();
  const isReordered = order(before.threads.filter((t) => did.has(t.id))) !== order(after.threads.filter((t) => was.has(t.id)));
  let next: State = { ...state, threads: isReordered && order(state.threads) === order(after.threads) ? sortLike(threads, before.threads) : threads };
  for (const key of SLICES) {
    if (before[key] === after[key]) continue;
    if (state[key] !== after[key]) kept++;
    else next = { ...next, [key]: before[key] };
  }
  return { state: next, kept };
}

function sortLike(threads: Thread[], reference: Thread[]) {
  const rank = new Map(reference.map((t, i) => [t.id, i]));
  return [...threads].sort((a, b) => (rank.get(a.id) ?? reference.length) - (rank.get(b.id) ?? reference.length));
}
