import { RefIcon, RefListHoverCard } from '../chat/RefHoverCard';
import { refDescription } from '@mochi/domain/chat/refs';
import type { Thread } from '../model';
import { plural } from '@mochi/domain/lib/format';
import { useThreadPrs } from './useThreadPrs';

const MAX_SHOWN = 3;

/** The thread's PRs as small bare state icons, most-needs-you first, past `MAX_SHOWN` a "+N"; hovering any of it lists every PR in one card. */
export function PrStack({ thread }: { thread: Thread }) {
  const prs = useThreadPrs(thread);
  if (prs.length === 0) return null;
  const shown = prs.slice(0, MAX_SHOWN);
  const hidden = prs.length - shown.length;
  const title = plural(
    prs.length,
    '1 pull request',
    `${prs.length} pull requests`,
  );
  return (
    <RefListHoverCard items={prs} title={title} side="bottom" align="end">
      <span
        role="list"
        tabIndex={0}
        data-nested-preview
        aria-label={`${title}: ${prs.map((p) => `${p.label} ${refDescription('pr', p.state)}`).join(', ')}`}
        className={MARK}
      >
        {shown.map((item) => (
          <span key={item.label} role="listitem" className="flex">
            {/* `!`: the sidebar button sizes every svg inside it to 16px. */}
            <RefIcon item={item} className="size-3!" />
          </span>
        ))}
        {hidden > 0 && (
          <span className="tabular type-caption text-muted-foreground">
            +{hidden}
          </span>
        )}
      </span>
    </RefListHoverCard>
  );
}

const MARK =
  'flex shrink-0 cursor-default items-center gap-1 rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring';
