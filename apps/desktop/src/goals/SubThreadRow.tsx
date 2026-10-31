import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import type { Thread } from '../model';
import { PrStack } from '../git/PrStack';
import { ThreadPeek } from '../layout/ThreadPeek';
import { AgentsBadge, rowStatusMark, useThreadRow } from '../threadRow';
import { StatusMark } from '../ui';
import { TONE_TEXT, useOpenThread } from './SubThreads';

/** A sub-thread read like its sidebar row: title and status mark, then what it's doing or why it stopped, its PRs and agents. Hover for its peek; the row opens it. */
export function SubThreadRow({
  sub,
  peekSide = 'top',
  className,
}: {
  sub: Thread;
  peekSide?: 'top' | 'left';
  className?: string;
}) {
  const row = useThreadRow(sub);
  const mark = rowStatusMark(row);
  const open = useOpenThread();
  const asks = row.tone === 'warning' || row.tone === 'destructive';
  // In the chat the peek opens above the row, not beside it: to the right is past the chat column.
  return (
    <ThreadPeek thread={sub} isDisabled={false} side={peekSide}>
      <div
        className={cn(
          'relative isolate flex min-w-0 flex-col gap-0.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60',
          className,
        )}
      >
        <button
          type="button"
          aria-label={`Open ${sub.title}`}
          onClick={() => open(sub)}
          className="absolute inset-0 cursor-default rounded-[inherit] focus-visible:outline-2"
        />
        <span className="flex min-w-0 items-center gap-2 type-meta">
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              row.isUnread ? 'text-foreground' : 'text-foreground/80',
            )}
          >
            {sub.title}
          </span>
          {mark && <StatusMark {...mark} />}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 type-caption text-subtle-foreground">
          {row.isWorking ? (
            <Shimmer as="span" className="min-w-0 flex-1 truncate">
              {row.detail}
            </Shimmer>
          ) : (
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                asks && TONE_TEXT[row.tone!],
              )}
            >
              {sub.parent?.handedBackAt ? 'Handed back' : row.detail}
            </span>
          )}
          {/* Above the row's open button, so its PR card opens on hover and its links take the click. */}
          <span className="relative z-10 flex">
            <PrStack thread={sub} />
          </span>
          <AgentsBadge thread={sub} />
        </span>
      </div>
    </ThreadPeek>
  );
}
