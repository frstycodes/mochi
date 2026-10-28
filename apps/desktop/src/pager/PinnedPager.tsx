import { useEffect, useRef } from 'react';
import { COMPOSER_EDITABLE } from '../chat/ComposerEditor';
import { LeafView, Workspace, WorkspaceEffects } from '../layout/Workspace';
import type { Leaf } from '@mochi/domain/layout/tree';
import { useMergeThreads } from '../remote/MergedScope';
import { Overview } from '../stage/Overview';
import { useHarnessSelector, type State } from '../store';
import { OFF_PIN, slotsOf } from './slots';
import { usePagerKeys } from './usePagerKeys';

/** The main area: the focused view full-width, a lone pinned thread drawn by the pager itself. Pinned threads are switched from the sidebar or the keyboard, never slid between. */
export function PinnedPager() {
  const merge = useMergeThreads();
  const centerId = useHarnessSelector((s) => {
    const slots = slotsOf(s, merge(s));
    return slots.ids[slots.center];
  });
  const live = useHarnessSelector((s) => liveLeaf(s, centerId));
  const isOverview = useHarnessSelector((s) => s.isOverview);
  useCaretFollowsPage(centerId);

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <WorkspaceEffects />
      <PagerEffects />
      {live ? (
        <LeafView
          key={centerId}
          leaf={live}
          isMulti={false}
          isZoomed={false}
          isFirst
        />
      ) : (
        <Workspace />
      )}
      {isOverview && <Overview />}
    </div>
  );
}

/** The pager's whole-state side effects, in a leaf of their own so the pages don't re-render with every change. */
function PagerEffects() {
  usePagerKeys();
  return null;
}

/** The layout's only leaf when it shows the pinned thread on the current page: then that page is a lone split rendered by the pager itself. */
function liveLeaf(state: State, centerId: string): Leaf | undefined {
  const { root } = state.layouts[state.spaceId];
  if (
    centerId === OFF_PIN ||
    root.kind !== 'leaf' ||
    root.view.kind !== 'thread' ||
    root.view.id !== centerId
  )
    return undefined;
  return root;
}

/** Landing on a page moves the caret into its composer when it was in the page you left, which just went inert. */
function useCaretFollowsPage(centerId: string) {
  const previous = useRef(centerId);
  useEffect(() => {
    if (previous.current === centerId) return;
    previous.current = centerId;
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest('[inert]'))
      return;
    document
      .querySelector<HTMLElement>(`[data-leaf-id] ${COMPOSER_EDITABLE}`)
      ?.focus({ preventScroll: true });
  }, [centerId]);
}
