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

/** A space's pinned threads in pin order: the order behind Orbit slots, mod 1–9 and Stage Manager. */
export function pinnedThreads(threads: Thread[], spaceId: string) {
  return threads.filter((t) => t.spaceId === spaceId && t.orbitSlot !== undefined && t.status !== 'settled').sort((a, b) => a.orbitSlot! - b.orbitSlot!);
}

export function activeThreads(threads: Thread[], spaceId: string) {
  return threads.filter((t) => t.spaceId === spaceId && t.orbitSlot === undefined && t.status !== 'settled');
}

/** mod Shift P: the `reorder` lists that pin a thread at the end of Pinned, or unpin it to the top of Threads. Null when Pinned is full. */
export function togglePin(threads: Thread[], spaceId: string, id: string) {
  const pinned = pinnedThreads(threads, spaceId).map((t) => t.id);
  const unpinned = activeThreads(threads, spaceId).map((t) => t.id);
  if (pinned.includes(id)) return { pinned: pinned.filter((p) => p !== id), unpinned: [id, ...unpinned] };
  if (pinned.length >= PIN_SLOTS.length) return null;
  return { pinned: [...pinned, id], unpinned: unpinned.filter((u) => u !== id) };
}

/** Alt ↑/↓ over the combined list [...pinned, ...unpinned]: crossing the boundary pins or unpins. */
export function stepPin(pinned: string[], unpinned: string[], id: string, step: 1 | -1) {
  const isPinned = pinned.includes(id);
  const list = isPinned ? pinned : unpinned;
  const i = list.indexOf(id);
  const j = i + step;
  if (j >= 0 && j < list.length) {
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return isPinned ? { pinned: next, unpinned } : { pinned, unpinned: next };
  }
  if (isPinned && step === 1) return { pinned: pinned.filter((p) => p !== id), unpinned: [id, ...unpinned] };
  if (!isPinned && step === -1 && pinned.length < PIN_SLOTS.length) return { pinned: [...pinned, id], unpinned: unpinned.filter((u) => u !== id) };
  return null;
}

/** Drag drop: the `reorder` lists with `id` inserted at `index` of Pinned or Threads. Null when that would overfill Pinned. */
export function dropPin(pinned: string[], unpinned: string[], id: string, toPinned: boolean, index: number) {
  const p = pinned.filter((x) => x !== id);
  const u = unpinned.filter((x) => x !== id);
  const target = toPinned ? p : u;
  target.splice(Math.min(index, target.length), 0, id);
  if (p.length > PIN_SLOTS.length) return null;
  return { pinned: p, unpinned: u };
}
