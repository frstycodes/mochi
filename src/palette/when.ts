import { findLeaf, leaves } from '../layout/tree.ts';
import type { Thread } from '../model.ts';
import { pinnedThreads } from '../reorder.ts';
import { reviewThreads } from '../review/order.ts';
import type { State } from '../store/index.tsx';

/** What the palette knows about where you are, so actions can hide when they would do nothing. */
export interface ActionScope {
  thread: Thread | undefined;
  isPinned: boolean;
  spaceId: string;
  leafCount: number;
  reviewCount: number;
}

type Rule = (scope: ActionScope) => boolean;

const isLive: Rule = (s) => !!s.thread && s.thread.status !== 'settled';

export const when = {
  thread: (s: ActionScope) => !!s.thread,
  liveThread: isLive,
  settledThread: (s: ActionScope) => s.thread?.status === 'settled',
  unpinned: (s: ActionScope) => isLive(s) && !s.isPinned,
  pinned: (s: ActionScope) => isLive(s) && s.isPinned,
  repo: (s: ActionScope) => !!s.thread?.repo,
  splits: (s: ActionScope) => s.leafCount > 1,
  reviews: (s: ActionScope) => s.reviewCount > 0,
  otherSpace: (id: string) => (s: ActionScope) => s.spaceId !== id,
};

export function available<T extends { id: string; when?: Rule }>(actions: readonly T[], scope: ActionScope) {
  return actions.filter((a) => !a.when || a.when(scope));
}

export function scopeOf(state: State): ActionScope {
  const layout = state.layouts[state.spaceId];
  const view = findLeaf(layout.root, layout.focusId)?.view;
  const threadId = view?.kind === 'thread' ? view.id : view?.kind === 'tab' ? view.threadId : undefined;
  const thread = state.threads.find((t) => t.id === threadId);
  return {
    thread,
    isPinned: !!thread && pinnedThreads(state.threads, state.spaceId).includes(thread),
    spaceId: state.spaceId,
    leafCount: leaves(layout.root).length,
    reviewCount: reviewThreads(state).length,
  };
}
