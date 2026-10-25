import type { Capabilities } from '@mochi/schema';
import type { ThreadItem } from '@mochi/domain';

/** Events a connection without `code` still gets: none of these carry a diff. */
const PLAIN_EVENTS = new Set(['thread.saved', 'thread.deleted']);

type SavedThread = {
  thread?: { activity?: { patch?: unknown }[] };
  checkpoints?: unknown;
};

/**
 * Without `code` a connection gets no diffs: a thread's tool patches and its checkpoints (whole thread copies tied to
 * worktree refs) stay home.
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
  const { checkpoints: _checkpoints, ...rest } = saved;
  const activity = saved.thread.activity?.map(
    ({ patch: _patch, ...entry }) => entry,
  );
  return {
    ...item,
    saved: {
      ...rest,
      thread: { ...saved.thread, ...(activity && { activity }) },
    },
  };
}
