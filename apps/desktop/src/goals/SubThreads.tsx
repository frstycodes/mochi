import { DiagramTree } from '@/icons';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import type { ActivityEntry, Thread } from '../model';
import { ThreadName } from '../chat/ThreadMessage';
import { parentOf } from '../reorder';
import { useHarness } from '../store';
import { threadStatus } from './VerdictChip';
import type { Verdict } from './verdict';

/** Working (shimmering), handed back, or the verdict's word in its tone. */
export function SubThreadState({
  sub,
  status,
  className,
}: {
  sub: Thread;
  status: ReturnType<typeof threadStatus>;
  className?: string;
}) {
  if (status.isWorking)
    return (
      <Shimmer as="span" className={cn('shrink-0', className)}>
        Working
      </Shimmer>
    );
  if (sub.parent?.handedBackAt)
    return (
      <span className={cn('shrink-0 text-muted-foreground', className)}>
        Handed back
      </span>
    );
  return (
    <span
      className={cn('shrink-0', TONE_TEXT[status.tone ?? 'muted'], className)}
    >
      {status.status}
    </span>
  );
}

/** On a sub-thread's own card: which thread it belongs to. */
export function SubThreadLineage({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const parent = parentOf(state.threads, thread);
  if (!parent) return null;
  return (
    <p className="flex min-w-0 items-center gap-1.5 type-meta text-muted-foreground">
      <DiagramTree aria-hidden className="size-3.5 shrink-0" />
      <span className="shrink-0">Sub-thread of</span>
      <ThreadName peer={{ threadId: parent.id, title: parent.title }} />
    </p>
  );
}

/** A sub-thread's result in its parent's chat: its name (opens it), then what it handed back. */
export function SubThreadResultRow({
  entry,
  result,
}: {
  entry: ActivityEntry;
  result: NonNullable<ActivityEntry['subThread']>;
}) {
  return (
    <div
      className="-mx-2 flex min-h-7 w-fit max-w-full min-w-0 items-center gap-2 rounded-lg px-2 type-meta text-muted-foreground"
      title={entry.text}
    >
      <DiagramTree aria-hidden className="size-4 shrink-0" />
      <span className="flex min-w-0 items-center gap-1.5">
        <ThreadName peer={{ threadId: result.threadId, title: result.title }} />
        <span className="shrink-0">handed back</span>
        <span className="min-w-0 truncate text-subtle-foreground">
          {result.text}
        </span>
      </span>
    </div>
  );
}

/**
 * The sidebar's guide from a parent to one sub-thread, drawn in a `relative` row 15px in from the parent's ring centre: the line
 * runs down past every sibling but the last, and a curve leaves it into the row's ring. The colour is opaque (mixed into the
 * sidebar, not an alpha): the curve's antialiased start overlaps the trunk, and a translucent stroke would brighten every overlap.
 */
export function SubThreadGuide({
  isLast,
  className,
}: {
  isLast: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('pointer-events-none absolute inset-y-0 left-0', className)}
    >
      {/* Stops where the curve starts on the last row; elsewhere runs 2px on to meet the next row's trunk across the list's gap. */}
      <span
        className={cn(
          'absolute top-0 left-0 border-l',
          GUIDE,
          isLast ? 'h-2.5' : '-bottom-0.5',
        )}
      />
      {/* Only the last row joins the line; lands at 16px, mid first line (6px padding + half of 20px). */}
      {isLast && (
        <span
          className={cn(
            'absolute top-2.5 left-0 h-1.5 w-2.5 rounded-bl-[6px] border-b border-l',
            GUIDE,
          )}
        />
      )}
    </span>
  );
}

const GUIDE =
  'border-[color-mix(in_oklab,var(--subtle-foreground)_40%,var(--sidebar))]';

export function useOpenThread() {
  const { state, dispatch } = useHarness();
  return (thread: Thread) => {
    if (thread.spaceId !== state.spaceId)
      dispatch({ type: 'space', id: thread.spaceId });
    dispatch({ type: 'go', view: { kind: 'thread', id: thread.id } });
  };
}

export const TONE_TEXT = {
  warning: 'text-warning',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
} satisfies Record<Verdict['tone'], string>;
