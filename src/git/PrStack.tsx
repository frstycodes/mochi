import { useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react';
import { RefCarouselHoverCard, RefHoverCard, RefIcon } from '../chat/RefHoverCard';
import { refDescription } from '../chat/refs';
import type { Thread } from '../model';
import { cn } from '@/lib/utils';
import { useThreadPrs, type ThreadPr } from './useThreadPrs';

const MAX_SHOWN = 3;

/**
 * The thread's PRs as overlapping state discs, most-needs-you first, at most `MAX_SHOWN` then "+N". The stack is one focus
 * stop and one card: with several PRs the card pages through all of them, hovering a disc (or ↑ / ↓) moves to its PR.
 */
export function PrStack({ thread }: { thread: Thread }) {
  const prs = useThreadPrs(thread);
  const [active, setActive] = useState(0);
  if (prs.length === 0) return null;
  const shown = prs.slice(0, MAX_SHOWN);
  const hidden = prs.length - shown.length;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    e.stopPropagation();
    setActive((i) => Math.min(prs.length - 1, Math.max(0, i + (e.key === 'ArrowUp' ? -1 : 1))));
  };
  return (
    <StackCard prs={prs} active={active}>
      <span
        role="group"
        tabIndex={0}
        data-nested-preview
        aria-label={prs.map((p) => `${p.label} ${refDescription('pr', p.state)}`).join(', ')}
        aria-keyshortcuts={prs.length > 1 ? 'ArrowUp ArrowDown' : undefined}
        onKeyDown={onKeyDown}
        className="flex shrink-0 cursor-default items-center rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        {shown.map((item, i) => (
          <span key={item.label} aria-hidden onPointerEnter={() => setActive(i)} className={DISC} style={i > 0 ? OVERLAP : undefined}>
            <RefIcon item={item} className="size-2.5" />
          </span>
        ))}
        {hidden > 0 && (
          <span aria-hidden onPointerEnter={() => setActive(MAX_SHOWN)} className={cn(DISC, 'text-[0.5625rem] font-semibold text-muted-foreground tabular')} style={OVERLAP}>
            +{hidden}
          </span>
        )}
      </span>
    </StackCard>
  );
}

function StackCard({ prs, active, children }: { prs: ThreadPr[]; active: number; children: ReactElement }) {
  if (prs.length === 1)
    return (
      <RefHoverCard item={prs[0]} side="bottom" align="start">
        {children}
      </RefHoverCard>
    );
  return (
    <RefCarouselHoverCard items={prs} index={active} side="bottom" align="start">
      {children}
    </RefCarouselHoverCard>
  );
}

const DISC = 'flex size-4 shrink-0 items-center justify-center rounded-full bg-muted';

// Each 16px disc after the first slides 2px under the one before it; the mask cuts a 1.5px gap around that disc, so the
// overlap reads on any row surface (hovered, selected) without a ring colour to keep in sync. The previous disc's centre
// sits at 2px overlap - 8px radius = -6px; the cut reaches 3.5px in, about the edge of the 10px icon.
const OVERLAP = { marginLeft: -2, maskImage: 'radial-gradient(circle 9.5px at -6px 50%, transparent 99%, #000 100%)' } satisfies CSSProperties;
