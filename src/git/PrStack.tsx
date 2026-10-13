import type { CSSProperties } from 'react';
import { RefHoverCard, RefIcon, RefListHoverCard } from '../chat/RefHoverCard';
import { refDescription } from '../chat/refs';
import type { Thread } from '../model';
import { cn } from '@/lib/utils';
import { useThreadPrs } from './useThreadPrs';

const MAX_SHOWN = 3;

/** The thread's PRs as overlapping state discs, most-needs-you first; past `MAX_SHOWN` a "+N" disc lists them all on hover. */
export function PrStack({ thread }: { thread: Thread }) {
  const prs = useThreadPrs(thread);
  if (prs.length === 0) return null;
  const shown = prs.slice(0, MAX_SHOWN);
  const hidden = prs.length - shown.length;
  return (
    <span role="list" data-nested-preview aria-label={PLURAL.select(prs.length) === 'one' ? '1 pull request' : `${prs.length} pull requests`} className="-my-1 flex shrink-0 items-center">
      {shown.map((item, i) => (
        <RefHoverCard key={item.label} item={item} side="bottom" align="start">
          <span role="listitem" tabIndex={0} aria-label={`${item.label}: ${item.state.title}, ${refDescription('pr', item.state)}`} className={DISC} style={i > 0 ? OVERLAP : undefined}>
            <RefIcon item={item} className="size-3" />
          </span>
        </RefHoverCard>
      ))}
      {hidden > 0 && (
        <RefListHoverCard items={prs} title={`${prs.length} pull requests`} side="bottom" align="start">
          <span role="listitem" tabIndex={0} aria-label={`${hidden} more, show all ${prs.length} pull requests`} className={cn(DISC, 'text-[0.625rem] font-semibold text-muted-foreground tabular')} style={OVERLAP}>
            +{hidden}
          </span>
        </RefListHoverCard>
      )}
    </span>
  );
}

const DISC = 'flex size-5 shrink-0 cursor-default items-center justify-center rounded-full bg-muted outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring';

// Each 20px disc after the first slides 3px under the one before it; the mask cuts a 1.5px gap around that disc, so the
// overlap reads on any row surface (hovered, selected) without a ring colour to keep in sync. The previous disc's centre
// sits at 3px overlap - 10px radius = -7px; the cut reaches 4.5px in, just short of the 12px icon.
const OVERLAP = { marginLeft: -3, maskImage: 'radial-gradient(circle 11.5px at -7px 50%, transparent 99%, #000 100%)' } satisfies CSSProperties;

const PLURAL = new Intl.PluralRules('en');
