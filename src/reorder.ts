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

/** A space's pinned threads in pin order: the order behind Orbit slots, mod 1–9 and the pinned pager. */
export function pinnedThreads(threads: Thread[], spaceId: string) {
  return threads.filter((t) => t.spaceId === spaceId && t.orbitSlot !== undefined && t.status !== 'settled').sort((a, b) => a.orbitSlot! - b.orbitSlot!);
}

/** A space's unpinned threads, most recent activity first; only pinned threads keep a manual order. */
export function activeThreads(threads: Thread[], spaceId: string) {
  return threads.filter((t) => t.spaceId === spaceId && t.orbitSlot === undefined && t.status !== 'settled').sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
}

/** The parent a sub-thread nests under in the sidebar; none once that parent is settled or gone, so the sub-thread stands on its own. */
export function parentOf(threads: Thread[], thread: Thread) {
  const id = thread.parent?.threadId;
  return id ? threads.find((p) => p.id === id && p.spaceId === thread.spaceId && p.status !== 'settled') : undefined;
}

/** A thread's sub-threads, settled ones included, in the order they were started. */
export function subThreadsOf(threads: Thread[], parentId: string) {
  return threads.filter((t) => t.parent?.threadId === parentId).sort((a, b) => a.startedAt - b.startedAt);
}

/** Why `id` can't nest under `parentId`, or null when it can: one level deep, never itself, never under one of its own sub-threads. */
export function nestBlocker(threads: Thread[], id: string, parentId: string) {
  const parent = threads.find((t) => t.id === parentId);
  if (id === parentId || !parent) return 'Not a thread to nest under';
  if (parent.parent) return 'Sub-threads nest one level deep';
  if (threads.some((t) => t.parent?.threadId === id && t.status !== 'settled')) return 'It has sub-threads of its own';
  return null;
}

/** A top-level sidebar row with the sub-threads nested under it: open ones in start order, finished ones only counted. */
export interface ThreadGroup {
  thread: Thread;
  subs: Thread[];
  settledSubs: number;
}

/** Pinned and Threads as the sidebar shows them: top-level rows only, each carrying its sub-threads wherever they'd sort alone. */
export function sidebarGroups(threads: Thread[], spaceId: string) {
  const group = (t: Thread): ThreadGroup => {
    const subs = subThreadsOf(threads, t.id);
    return { thread: t, subs: subs.filter((s) => s.status !== 'settled'), settledSubs: subs.filter((s) => s.status === 'settled').length };
  };
  const isTop = (t: Thread) => !parentOf(threads, t);
  return { pinned: pinnedThreads(threads, spaceId).filter(isTop).map(group), active: activeThreads(threads, spaceId).filter(isTop).map(group) };
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
export function pinMany(threads: Thread[], spaceId: string, ids: string[]) {
  let current = threads;
  let lists: { pinned: string[]; unpinned: string[] } | null = null;
  for (const id of ids) {
    lists = togglePin(current, spaceId, id);
    if (!lists) return null;
    current = reorderThreads(current, lists.pinned, lists.unpinned);
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

/** A sidebar row as laid out: list-relative `top`, its height, which section, and the parent for a sub-thread's row. */
export interface RowBox {
  id: string;
  top: number;
  height: number;
  isPinned: boolean;
  parentId?: string;
}

export interface DropAt {
  /** Where a reorder would land; null leaves the row where it is. */
  slot: { toPinned: boolean; index: number } | null;
  /** The top-level row the pointer holds over the middle of, to nest under once it has stayed there. */
  nestUnder: string | null;
}

/**
 * Where a dragged row would go. The middle half of a top-level row nests under it (when it may), the rest reorders as before
 * (Pinned above the Threads label unless Pinned is full). A sub-thread dragged within its own group stays put: moving it out
 * takes leaving the group.
 */
export function dropAt(rows: RowBox[], labelMid: number, dragged: { id: string; parentId?: string }, y: number, isPinnedFull: boolean, canNest: (parentId: string) => boolean): DropAt {
  const over = rows.find((r) => !r.parentId && r.id !== dragged.id && y >= r.top + r.height / 4 && y <= r.top + (r.height * 3) / 4);
  const nestUnder = over && over.id !== dragged.parentId && canNest(over.id) ? over.id : null;
  const group = dragged.parentId ? rows.filter((r) => r.id === dragged.parentId || r.parentId === dragged.parentId) : [];
  const isInGroup = group.length > 0 && y >= Math.min(...group.map((r) => r.top)) && y <= Math.max(...group.map((r) => r.top + r.height));
  if (nestUnder || isInGroup) return { slot: null, nestUnder };
  const toPinned = y < labelMid && !isPinnedFull;
  const index = rows.filter((r) => !r.parentId && r.id !== dragged.id && r.isPinned === toPinned && r.top + r.height / 2 < y).length;
  return { slot: { toPinned, index }, nestUnder: null };
}
