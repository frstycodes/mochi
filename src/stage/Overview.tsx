import { useEffect, useRef } from 'react';
import { X } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { activeThreads, pinnedThreads } from '../reorder';
import { TOGGLE_RESERVE, useToggleSlot } from '../SidebarToggle';
import { useHarness } from '../store';
import { SnapshotCard } from './SnapshotCard';
import { useThreadSnapshots } from './snapshot';

/** Cmd ↑: every running session in the space as a grid of snapshot cards, pinned first in pin order. Opens and closes without animation (keyboard). */
export function Overview() {
  const { reservesToggle } = useToggleSlot(true);
  const { state, dispatch } = useHarness();
  const pinned = pinnedThreads(state.threads, state.spaceId).map((t) => t.id);
  const others = activeThreads(state.threads, state.spaceId).map((t) => t.id);
  const pinnedSnaps = useThreadSnapshots(pinned);
  const otherSnaps = useThreadSnapshots(others);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus({ preventScroll: true }), []);

  const close = () => dispatch({ type: 'overview-toggle', isOpen: false });
  const open = (id: string) => {
    dispatch({ type: 'go', view: { kind: 'thread', id } });
    close();
  };
  const groups = [
    { label: 'Pinned', snaps: pinnedSnaps },
    { label: 'Threads', snaps: otherSnaps },
  ].filter((g) => g.snaps.length > 0);

  return (
    <div role="dialog" aria-modal aria-label="All sessions" className="absolute inset-0 z-30 flex flex-col overflow-y-auto bg-background">
      <header className={cn('flex h-11 shrink-0 items-center gap-3 px-4', reservesToggle && TOGGLE_RESERVE)}>
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
      </header>
      <div className="flex flex-col gap-6 px-4 pb-6">
        {groups.map((g, gi) => (
          <section key={g.label} className="flex flex-col gap-2">
            <h3 className="type-meta font-medium text-muted-foreground">{g.label}</h3>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
              {g.snaps.map((snap, i) => (
                <li key={snap.id}>
                  <button
                    ref={gi === 0 && i === 0 ? first : undefined}
                    type="button"
                    onClick={() => open(snap.id)}
                    aria-label={`Open ${snap.title}`}
                    className="block h-44 w-full cursor-default rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <SnapshotCard snap={snap} className="size-full transition-[box-shadow] hover:shadow-float" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
