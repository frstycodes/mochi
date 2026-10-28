import type { Capabilities } from '@mochi/schema';
import type { ThreadItem } from '@mochi/domain';
import type { ReplicaItem } from '../store/rpc.ts';

type Snapshot = Extract<typeof ReplicaItem.Type, { _tag: 'snapshot' }>;

/** Events a connection without `code` still gets: none of these carry a diff. */
const PLAIN_EVENTS = new Set(['thread.saved', 'thread.deleted']);

type Activity = { activity?: { patch?: unknown }[] };
type SavedThread = {
  thread?: Activity;
  checkpoints?: unknown;
  sideChat?: unknown;
};

const withoutPatches = <T extends Activity>(thread: T): T =>
  thread.activity
    ? {
        ...thread,
        activity: thread.activity.map(({ patch: _patch, ...entry }) => entry),
      }
    : thread;

/**
 * Without `code` a connection gets no diffs: a thread's tool patches, its checkpoints (whole thread copies tied to worktree
 * refs) and its side chat (which quotes diffs and files) stay home.
 */
export function visibleItem(
  item: ThreadItem,
  scopes: ReadonlyArray<Capabilities.AuthScope>,
): ThreadItem | undefined {
  if (scopes.includes('code')) return item;
  // GAP: agent events, once they are logged, are held back whole; strip their patches instead when they arrive.
  if (item._tag === 'event')
    return PLAIN_EVENTS.has(item.event.type) ? item : undefined;
  const saved = item.saved as SavedThread | null;
  if (!saved?.thread) return item;
  const { checkpoints: _checkpoints, sideChat: _sideChat, ...rest } = saved;
  return {
    ...item,
    saved: { ...rest, thread: withoutPatches(saved.thread) },
  };
}

type Saved = {
  threads?: Activity[];
  checkpoints?: unknown;
  remoteSideChats?: unknown;
};

/**
 * A `replica` snapshot as a connection may see it: `context` (prefs, pins, profiles with their folders) only for this
 * computer's own clients, and without `code` the whole store's diffs held back as `visibleItem` holds back one thread's.
 */
export function visibleSnapshot(
  item: Snapshot,
  scopes: ReadonlyArray<Capabilities.AuthScope>,
): Snapshot {
  const context = scopes.includes('local') ? item.context : null;
  const saved = item.saved as Saved | null;
  if (scopes.includes('code') || !saved) return { ...item, context };
  const { remoteSideChats: _sideChats, ...rest } = saved;
  return {
    ...item,
    context,
    saved: {
      ...rest,
      ...(saved.threads && { threads: saved.threads.map(withoutPatches) }),
      checkpoints: {},
    },
  };
}
