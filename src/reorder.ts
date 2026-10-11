import { PIN_SLOTS, type Thread } from './model.ts';

/** Sidebar drag and drop: pinned threads take Orbit slots in list order, both lists keep the dropped order, threads not listed stay where they were. */
export function reorderThreads(threads: Thread[], pinned: string[], unpinned: string[]): Thread[] {
  if (pinned.length > PIN_SLOTS.length) return threads;
  const order = [...pinned, ...unpinned];
  const rank = (t: Thread) => order.indexOf(t.id);
  const moved = threads
    .filter((t) => rank(t) >= 0)
    .sort((a, b) => rank(a) - rank(b))
    .map((t) => ({ ...t, orbitSlot: pinned.includes(t.id) ? PIN_SLOTS[pinned.indexOf(t.id)] : undefined }));
  let i = 0;
  return threads.map((t) => (rank(t) >= 0 ? moved[i++] : t));
}
