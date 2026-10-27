import { DiagramTree } from '@/icons';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import { plural } from '@mochi/domain/lib/format';
import type { Thread } from '../model';
import { isWorking } from '../agentPhase';
import { PrStack } from '../git/PrStack';
import { ThreadPeek } from '../layout/ThreadPeek';
import { subThreadsOf } from '../reorder';
import { useHarness } from '../store';
import { AgentsBadge, rowStatusMark, useThreadRow } from '../threadRow';
import { StatusMark } from '../ui';
import { TONE_TEXT, useOpenThread } from './SubThreads';

/**
 * A parent's open sub-threads in its chat, read like their sidebar rows and never boxed: title and status dot, then what it's doing or
 * why it stopped, its PRs and agents. Hover the row for the thread's peek, the PRs for theirs; the row opens it.
 */
export function SubThreadList({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const subs = subThreadsOf(state.threads, thread.id).filter(
    (t) => t.status !== 'settled',
  );
  if (!subs.length) return null;
  return (
    <div className="flex flex-col gap-1">
      {subs.length > 1 && <SubThreadCount subs={subs} />}
      <ul aria-label="Sub-threads" className="-mx-2 flex flex-col">
        {subs.map((sub) => (
          <SubThreadRow key={sub.id} sub={sub} />
        ))}
      </ul>
    </div>
  );
}

/** "3 sub-threads · 1 working · 1 needs you", so a long list says where to look first. */
function SubThreadCount({ subs }: { subs: Thread[] }) {
  const working = subs.filter(isWorking).length;
  const asks = subs.filter((t) => t.status === 'needs-you').length;
  return (
    <p className="flex items-center gap-1.5 type-caption text-muted-foreground">
      <DiagramTree aria-hidden className="size-3.5 shrink-0" />
      <span className="tabular">{`${subs.length} sub-threads`}</span>
      {working > 0 && <span className="tabular">{`· ${working} working`}</span>}
      {asks > 0 && (
        <span className="tabular text-warning">{`· ${asks} ${plural(asks, 'needs', 'need')} you`}</span>
      )}
    </p>
  );
}

function SubThreadRow({ sub }: { sub: Thread }) {
  const row = useThreadRow(sub);
  const mark = rowStatusMark(row);
  const open = useOpenThread();
  const asks = row.tone === 'warning' || row.tone === 'destructive';
  // The peek opens above the row, not beside it: to the right is past the chat column.
  return (
    <ThreadPeek thread={sub} isDisabled={false} side="top">
      <li className="relative isolate flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent/60">
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
      </li>
    </ThreadPeek>
  );
}
