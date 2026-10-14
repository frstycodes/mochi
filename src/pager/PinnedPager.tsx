import { useDeferredValue, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { haptic } from '../haptic';
import { LeafView, Workspace, WorkspaceEffects } from '../layout/Workspace';
import type { Leaf } from '../layout/tree';
import { Overview } from '../stage/Overview';
import { useWindowSyncHost } from '../stage/windowSync';
import { useHarness, type State } from '../store';
import { useSnapPager } from '../useSnapPager';
import { isHot, OFF_PIN, slotsOf } from './slots';
import { usePagerKeys } from './usePagerKeys';
import { useOnePagePerSwipe } from './useOnePagePerSwipe';

/**
 * The main area: pinned threads side by side as full-width pages of one native horizontal scroller, the focused view on its page.
 * `snap-mandatory` + `snap-always` stop a gesture at the next page; the browser owns tracking and momentum, so a two-finger swipe
 * is 1:1 and nothing here springs. Pages are keyed by thread, so landing on one flips it from preview to live without a remount.
 */
export function PinnedPager() {
  const { state, dispatch } = useHarness();
  useWindowSyncHost();
  const slots = slotsOf(state);
  const live = liveLeaf(state, slots.ids[slots.center]);
  // Every pinned page stays mounted (pins cap at five, and a virtualized thread is cheap), so a quick run of swipes never lands on an empty page.
  // When the set changes (launch, a pin, another space) the current page and its neighbours commit first and the rest mount in a background render.
  const ids = slots.ids.join();
  const isWarm = useDeferredValue(ids, '') === ids;
  const isMounted = (i: number) => isWarm || isHot(i, slots.center);
  const scroller = useRef<HTMLDivElement>(null);
  const open = (id: string | undefined) => {
    if (id && id !== OFF_PIN) dispatch({ type: 'go', view: { kind: 'thread', id } });
  };
  // A swipe commits once it's over (`useOnePagePerSwipe` fires that scrollend), not on the ones raised along the way.
  const onSettle = (page: number) => {
    const el = scroller.current;
    if (el && el.dataset.wheeling === undefined) open(slots.ids[page]);
  };
  useSnapPager(scroller, { axis: 'x', index: slots.center, onSettle, onCross: haptic });
  usePagerKeys();
  useOnePagePerSwipe(scroller);
  useCaretFollowsPage(slots.ids[slots.center]);
  const pages = slots.ids.length;

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <WorkspaceEffects />
      <div
        ref={scroller}
        // Inline: the global unlayered `* { scrollbar-width: thin }` in index.css beats any Tailwind utility.
        style={{ scrollbarWidth: 'none' }}
        className="h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain"
      >
        <div className="relative h-full" style={{ width: `${pages * 100}%` }}>
          {slots.ids.map((_, i) => (
            <SnapPoint key={i} slot={i} pages={pages} />
          ))}
          {slots.ids.map((id, i) => {
            if (!isMounted(i)) return null;
            const isCenter = i === slots.center;
            if (isCenter && !live)
              return (
                <Page key="workspace" slot={i} pages={pages}>
                  <Workspace />
                </Page>
              );
            return (
              <Page key={id} slot={i} pages={pages} isOffscreen={!isCenter}>
                <LeafView leaf={isCenter ? live! : previewLeaf(id)} isMulti={false} isZoomed={false} isFirst isPreview={!isCenter} />
              </Page>
            );
          })}
        </div>
      </div>
      {state.isOverview && <Overview />}
    </div>
  );
}

/** The layout's only leaf when it shows the pinned thread on the current page: then that page is a lone split rendered by the pager itself. */
function liveLeaf(state: State, centerId: string): Leaf | undefined {
  const { root } = state.layouts[state.spaceId];
  if (centerId === OFF_PIN || root.kind !== 'leaf' || root.view.kind !== 'thread' || root.view.id !== centerId) return undefined;
  return root;
}

const previewLeaf = (id: string): Leaf => ({ kind: 'leaf', id: `preview-${id}`, view: { kind: 'thread', id } });

/**
 * The snap target of one slot, keyed by slot so it never unmounts when a swipe commits. Chromium re-snaps when the element it snapped to
 * leaves the DOM: with the content pages as targets, landing on a page removed the one beyond it and the scroller jumped back, undoing the swipe.
 */
function SnapPoint({ slot, pages }: { slot: number; pages: number }) {
  return <div aria-hidden className="pointer-events-none absolute snap-start snap-always" style={slotStyle(slot, pages)} />;
}

/**
 * One page of the scroll content, absolutely placed at its slot so the browser scrolls it natively (no JS transform trailing the compositor).
 * Off screen, `content-visibility: auto` skips its style, layout and paint, shimmers included, while live updates keep landing in it.
 */
function Page({ slot, pages, isOffscreen = false, children }: { slot: number; pages: number; isOffscreen?: boolean; children: ReactNode }) {
  return (
    <div className={cn('absolute', isOffscreen && '[content-visibility:auto]')} style={slotStyle(slot, pages)}>
      {children}
    </div>
  );
}

function slotStyle(slot: number, pages: number): CSSProperties {
  return { left: `${(slot * 100) / pages}%`, width: `${100 / pages}%`, top: 0, bottom: 0 };
}

/** Landing on a page moves the caret into its composer when it was in the page you left, which just went inert. */
function useCaretFollowsPage(centerId: string) {
  const previous = useRef(centerId);
  useEffect(() => {
    if (previous.current === centerId) return;
    previous.current = centerId;
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest('[inert]')) return;
    document.querySelector<HTMLElement>('[data-leaf-id] textarea')?.focus({ preventScroll: true });
  }, [centerId]);
}
