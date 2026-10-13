import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Grid, X } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ARROW_SIDE, neighbourInDirection, type Side } from '../layout/tree';
import { activeThreads, pinnedThreads } from '../reorder';
import { TitleBar } from '../TitleBar';
import { useHarness } from '../store';
import { THREAD_MENU } from '../menus/menus';
import { TargetContextMenu } from '../menus/TargetContextMenu';
import { SnapshotCard } from './SnapshotCard';
import { useThreadSnapshots } from './snapshot';

/** mod ↑: every running session in the space as a grid of snapshot cards, pinned first in pin order. Opens and closes without animation (keyboard). */
export function Overview() {
  const { state, dispatch } = useHarness();
  const pinned = pinnedThreads(state.threads, state.spaceId).map((t) => t.id);
  const others = activeThreads(state.threads, state.spaceId).map((t) => t.id);
  const pinnedSnaps = useThreadSnapshots(pinned);
  const otherSnaps = useThreadSnapshots(others);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus({ preventScroll: true }), []);

  const close = () => dispatch({ type: 'overview-toggle', isOpen: false });
  const open = (id: string | null) => {
    dispatch({ type: 'go', view: id ? { kind: 'thread', id } : { kind: 'new' } });
    close();
  };
  const groups = [
    { label: 'Pinned', snaps: pinnedSnaps },
    { label: 'Threads', snaps: otherSnaps },
  ].filter((g) => g.snaps.length > 0);

  return (
    <div role="dialog" aria-modal aria-label="All sessions" onKeyDown={moveFocus} className="absolute inset-0 z-30 flex flex-col overflow-y-auto bg-background">
      <TitleBar className="gap-3 px-4">
        <h2 className="type-title">All sessions</h2>
        <span className="type-meta text-subtle-foreground tabular">{pinned.length + others.length}</span>
        <span className="flex-1" />
        <Label className="gap-2 type-meta font-normal text-muted-foreground">
          <Switch size="sm" checked={state.isNeedsYouNear} onCheckedChange={() => dispatch({ type: 'stage-needs-you-near' })} />
          Stage Manager: needs-you cards nearest the center
        </Label>
        <Button variant="ghost" size="sm" onClick={close} className="gap-1.5 text-muted-foreground">
          <X />
          Close
          <Kbd>Esc</Kbd>
        </Button>
      </TitleBar>
      <div className="flex flex-col gap-6 px-4 pb-6">
        {groups.length === 0 && <NoSessions onStart={() => open(null)} />}
        {groups.map((g, gi) => (
          <section key={g.label} className="flex flex-col gap-2">
            <h3 className="type-meta font-medium text-muted-foreground">{g.label}</h3>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
              {g.snaps.map((snap, i) => (
                <li key={snap.id}>
                  <TargetContextMenu target={{ threadId: snap.id }} groups={THREAD_MENU}>
                    <button
                      ref={gi === 0 && i === 0 ? first : undefined}
                      type="button"
                      data-snap-id={snap.id}
                      onClick={() => open(snap.id)}
                      aria-label={`Open ${snap.title}`}
                      className="block h-44 w-full cursor-default rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <SnapshotCard snap={snap} className="size-full transition-[box-shadow] hover:shadow-float" />
                    </button>
                  </TargetContextMenu>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function NoSessions({ onStart }: { onStart: () => void }) {
  return (
    <Empty className="mt-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Grid />
        </EmptyMedia>
        <EmptyTitle>No sessions in this space</EmptyTitle>
        <EmptyDescription>Every thread you start here shows up as a card you can jump to.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={onStart}>
          New thread
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** Arrow keys move between cards by where they sit on screen, so it follows the grid however many columns fit. Enter opens the focused card. */
function moveFocus(e: KeyboardEvent<HTMLElement>) {
  const side = ARROW_SIDE[e.key as keyof typeof ARROW_SIDE];
  if (!side || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-snap-id]')];
  const current = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-snap-id]');
  if (!current) return cards[0]?.focus();
  const rects = Object.fromEntries(cards.map((c) => [c.dataset.snapId!, c.getBoundingClientRect()]));
  // A row with fewer cards has nothing straight below the right-hand columns: up and down fall back to the nearest card that way.
  const isVertical = side === 'top' || side === 'bottom';
  const next = neighbourInDirection(rects, current.dataset.snapId!, side) ?? (isVertical ? nearestInDirection(rects, current.dataset.snapId!, side) : undefined);
  e.preventDefault();
  if (next) cards.find((c) => c.dataset.snapId === next)?.focus();
}

function nearestInDirection(rects: Record<string, DOMRect>, fromId: string, side: Side) {
  const from = rects[fromId];
  const centre = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const a = centre(from);
  const ahead = { left: (r: DOMRect) => r.right <= from.left + 1, right: (r: DOMRect) => r.left >= from.right - 1, top: (r: DOMRect) => r.bottom <= from.top + 1, bottom: (r: DOMRect) => r.top >= from.bottom - 1 }[side];
  const distance = (r: DOMRect) => Math.hypot(centre(r).x - a.x, centre(r).y - a.y);
  return Object.entries(rects)
    .filter(([id, r]) => id !== fromId && ahead(r))
    .sort(([, x], [, y]) => distance(x) - distance(y))[0]?.[0];
}
