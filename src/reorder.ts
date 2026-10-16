import { PIN_SLOTS, type Thread } from './model.ts';

/**
 * Sidebar drag and drop: pinned threads take Orbit slots in list order, both lists keep the dropped order, threads not listed
 * stay where they were. Pins keep their order keys where the new order allows, so they stay put among your other computers'
 * pins (`pinKeys`); `at` (epoch ms) is the key a brand-new pin at the end takes.
 */
export function reorderThreads(threads: Thread[], pinned: string[], unpinned: string[], at: number): Thread[] {
  if (pinned.length > PIN_SLOTS.length) return threads;
  const order = [...pinned, ...unpinned];
  const rank = (t: Thread) => order.indexOf(t.id);
  const keys = pinKeys(pinned.map((id) => threads.find((t) => t.id === id)), at);
  const moved = threads
    .filter((t) => rank(t) >= 0)
    .sort((a, b) => rank(a) - rank(b))
    .map((t) => {
      const i = pinned.indexOf(t.id);
      return { ...t, orbitSlot: i >= 0 ? PIN_SLOTS[i] : undefined, pinOrder: i >= 0 ? keys[i] : undefined };
    });
  let i = 0;
  return threads.map((t) => (rank(t) >= 0 ? moved[i++] : t));
}

/**
 * One order across your computers' pins: each machine keeps its own threads' keys, and the sidebar sorts every pin by key.
 * A pin from before keys falls back to its Orbit slot, so it sorts first.
 */
export const pinOrderOf = (thread: Pick<Thread, 'pinOrder' | 'orbitSlot'>) => thread.pinOrder ?? thread.orbitSlot ?? 0;

/** Keys for `pinned` in that order, changing as few as it can: a key that still fits stays, one that doesn't moves just past its neighbour. */
function pinKeys(pinned: (Thread | undefined)[], at: number) {
  const keys: number[] = [];
  pinned.forEach((thread, i) => {
    const prev = keys[i - 1];
    const own = thread && (thread.pinOrder !== undefined || thread.orbitSlot !== undefined) ? pinOrderOf(thread) : undefined;
    if (own !== undefined && (prev === undefined || own > prev)) return keys.push(own);
    const next = pinned.slice(i + 1).map((t) => t && (t.pinOrder ?? t.orbitSlot)).find((k) => k !== undefined && (prev === undefined || k > prev));
    keys.push(orderBetween(prev, next, own === undefined ? at : undefined));
  });
  return keys;
}

/** A key between two pins' keys; past the last pin, `at` when it's later (a new pin goes last everywhere). */
export function orderBetween(prev: number | undefined, next: number | undefined, at?: number) {
  if (prev !== undefined && next !== undefined) return (prev + next) / 2;
  if (prev !== undefined) return Math.max(prev + 1, at ?? 0);
  if (next !== undefined) return next - 1;
  return at ?? 0;
}

/**
 * Pins `id` (or moves its pin) to order key `order` among all your computers' pins; this space's Orbit slots follow its pins
 * in key order. Null when Pinned is full.
 */
export function pinAt(threads: Thread[], spaceId: string, id: string, order: number): Thread[] | null {
  const target = threads.find((t) => t.id === id);
  if (!target) return threads;
  const others = pinnedThreads(threads, spaceId).filter((t) => t.id !== id);
  if (target.orbitSlot === undefined && others.length >= PIN_SLOTS.length) return null;
  const pins = [...others, { ...target, pinOrder: order }].sort((a, b) => pinOrderOf(a) - pinOrderOf(b));
  return threads.map((t) => {
    const i = pins.findIndex((p) => p.id === t.id);
    return i >= 0 ? { ...t, orbitSlot: PIN_SLOTS[i], pinOrder: pinOrderOf(pins[i]) } : t;
  });
}

/** A space's pinned threads in pin order: the order behind Orbit slots, mod 1–9 and the pinned pager. */
export function pinnedThreads(threads: Thread[], spaceId: string) {
  return threads.filter((t) => t.spaceId === spaceId && t.orbitSlot !== undefined && t.status !== 'settled').sort((a, b) => a.orbitSlot! - b.orbitSlot!);
}

/** A space's unpinned threads, most recent activity first; only pinned threads keep a manual order. */
export function activeThreads(threads: Thread[], spaceId: string) {
  return threads.filter((t) => t.spaceId === spaceId && t.orbitSlot === undefined && t.status !== 'settled').sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
}

export function lastActivityAt(thread: Thread) {
  return thread.activity[thread.activity.length - 1]?.at ?? thread.startedAt;
}

/** mod Shift P: the `reorder` lists that pin a thread at the end of Pinned, or unpin it to the top of Threads. Null when Pinned is full. */
export function togglePin(threads: Thread[], spaceId: string, id: string) {
  const pinned = pinnedThreads(threads, spaceId).map((t) => t.id);
  const unpinned = activeThreads(threads, spaceId).map((t) => t.id);
  if (pinned.includes(id)) return { pinned: pinned.filter((p) => p !== id), unpinned: [id, ...unpinned] };
  if (pinned.length >= PIN_SLOTS.length) return null;
  return { pinned: [...pinned, id], unpinned: unpinned.filter((u) => u !== id) };
}

/** Bulk pin or unpin: the `reorder` lists after toggling each of `ids` in turn, so pins land in selection order. Null when Pinned would overflow. */
export function pinMany(threads: Thread[], spaceId: string, ids: string[], at: number) {
  let current = threads;
  let lists: { pinned: string[]; unpinned: string[] } | null = null;
  for (const id of ids) {
    lists = togglePin(current, spaceId, id);
    if (!lists) return null;
    current = reorderThreads(current, lists.pinned, lists.unpinned, at);
  }
  return lists;
}

/** Alt ↑/↓: moves a pinned thread within Pinned, and down past the last pin unpins it; an unpinned thread (sorted by recency, no manual order) pins on ↑. */
export function stepPin(pinned: string[], unpinned: string[], id: string, step: 1 | -1) {
  if (!pinned.includes(id)) return step === -1 && pinned.length < PIN_SLOTS.length ? { pinned: [...pinned, id], unpinned: unpinned.filter((u) => u !== id) } : null;
  const i = pinned.indexOf(id);
  const j = i + step;
  if (j >= 0 && j < pinned.length) {
    const next = [...pinned];
    [next[i], next[j]] = [next[j], next[i]];
    return { pinned: next, unpinned };
  }
  if (step === 1) return { pinned: pinned.filter((p) => p !== id), unpinned: [id, ...unpinned] };
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
