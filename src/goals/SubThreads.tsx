import { ChevronRight, DiagramTree } from 'reicon-react';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { GitPullRequestIcon, REF_TONE_CLASS } from '@/icons/github';
import { cn } from '@/lib/utils';
import type { ActivityEntry, Criterion, Thread } from '../model';
import { ThreadName } from '../chat/ThreadMessage';
import { parentOf, subThreadsOf } from '../reorder';
import { useHarness } from '../store';
import { CallList } from '../WorkLog';
import { StatusRing, useThreadStatus } from './VerdictChip';
import type { Verdict } from './verdict';

/** A parent's sub-threads on its end-of-turn card: each one's ring, the criterion it covers, its state; the row opens it. */
export function SubThreadList({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const subs = subThreadsOf(state.threads, thread.id).filter((t) => t.status !== 'settled');
  if (!subs.length) return null;
  return (
    <CallList aria-label="Sub-threads">
      {subs.map((sub) => (
        <SubThreadRow key={sub.id} sub={sub} covers={thread.criteria?.find((c) => c.id === sub.parent?.criterionId)} />
      ))}
    </CallList>
  );
}

function SubThreadRow({ sub, covers }: { sub: Thread; covers?: Criterion }) {
  const status = useThreadStatus(sub);
  const open = useOpenThread();
  const pr = sub.prs.find((p) => p.state === 'open' || p.state === 'draft') ?? sub.prs.find((p) => p.state === 'merged');
  return (
    <li className="relative isolate flex min-h-11 min-w-0 items-center gap-2.5 px-3 py-1.5 type-meta hover:bg-accent/60">
      <button type="button" aria-label={`Open ${sub.title}`} onClick={() => open(sub)} className="absolute inset-0 cursor-default focus-visible:outline-2 focus-visible:-outline-offset-2" />
      <StatusRing met={status.progress.met} total={status.progress.total} tone={status.tone} isWorking={status.isWorking} slot={sub.line} label={status.status} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-foreground">{sub.title}</span>
        {!!covers && <span className="truncate type-caption text-subtle-foreground">{`For: ${covers.text}`}</span>}
      </span>
      <SubThreadState sub={sub} status={status} className="type-caption font-medium" />
      {!!pr && (
        <span className="flex shrink-0 items-center gap-1 tabular type-caption text-muted-foreground">
          <GitPullRequestIcon aria-hidden className={cn('size-3 shrink-0', REF_TONE_CLASS[pr.state === 'merged' ? 'merged' : 'success'])} />
          {`#${pr.number}`}
        </span>
      )}
      <ChevronRight aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />
    </li>
  );
}

/** Working (shimmering), handed back, or the verdict's word in its tone. */
function SubThreadState({ sub, status, className }: { sub: Thread; status: ReturnType<typeof useThreadStatus>; className?: string }) {
  if (status.isWorking) return <Shimmer as="span" className={cn('shrink-0', className)}>Working</Shimmer>;
  if (sub.parent?.handedBackAt) return <span className={cn('shrink-0 text-muted-foreground', className)}>Handed back</span>;
  return <span className={cn('shrink-0', TONE_TEXT[status.tone ?? 'muted'], className)}>{status.status}</span>;
}

/** On a sub-thread's own card: which thread it belongs to, and the criterion of that thread's goal it covers. */
export function SubThreadLineage({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const parent = parentOf(state.threads, thread);
  if (!parent) return null;
  const covers = parent.criteria?.find((c) => c.id === thread.parent?.criterionId);
  return (
    <p className="flex min-w-0 items-center gap-1.5 type-meta text-muted-foreground">
      <DiagramTree aria-hidden className="size-3.5 shrink-0" />
      <span className="shrink-0">Sub-thread of</span>
      <ThreadName peer={{ threadId: parent.id, title: parent.title }} />
      {!!covers && <span className="min-w-0 truncate">{`, for “${covers.text}”`}</span>}
    </p>
  );
}

/** A sub-thread's result in its parent's chat: its name (opens it), then what it handed back. */
export function SubThreadResultRow({ entry, result }: { entry: ActivityEntry; result: NonNullable<ActivityEntry['subThread']> }) {
  return (
    <div className="-mx-2 flex min-h-7 w-fit max-w-full min-w-0 items-center gap-2 rounded-lg px-2 type-meta text-muted-foreground" title={entry.text}>
      <DiagramTree aria-hidden className="size-4 shrink-0" />
      <span className="flex min-w-0 items-center gap-1.5">
        <ThreadName peer={{ threadId: result.threadId, title: result.title }} />
        <span className="shrink-0">handed back</span>
        <span className="min-w-0 truncate text-subtle-foreground">{result.text}</span>
      </span>
    </div>
  );
}

/** In the summary: a criterion a sub-thread owns. Its ring stands in for the tick, its proof line is the sub-thread's state; the row opens it. */
export function HandedCriterion({ criterion, sub }: { criterion: Criterion; sub: Thread }) {
  const status = useThreadStatus(sub);
  const open = useOpenThread();
  return (
    <li className="relative isolate -mx-1 flex gap-2 rounded-md px-1 type-meta hover:bg-accent/60">
      <button type="button" aria-label={`Open ${sub.title}`} onClick={() => open(sub)} className="absolute inset-0 cursor-default rounded-[inherit] focus-visible:outline-2" />
      <span className="mt-px flex shrink-0 [&_svg]:size-3.5!">
        <StatusRing met={status.progress.met} total={status.progress.total} tone={status.tone} isWorking={status.isWorking} slot={sub.line} label={status.status} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-pretty">
        <span className={cn(sub.parent?.handedBackAt ? 'text-foreground' : 'text-foreground/75')}>{criterion.text}</span>
        <span className="flex min-w-0 items-center gap-1 type-caption text-subtle-foreground">
          <DiagramTree aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{sub.title}</span>
          <span aria-hidden>·</span>
          <SubThreadState sub={sub} status={status} />
        </span>
      </span>
      <ChevronRight aria-hidden className="mt-1 size-3 shrink-0 text-subtle-foreground" />
    </li>
  );
}

/**
 * The sidebar's guide from a parent to one sub-thread, drawn in a `relative` row 15px in from the parent's ring centre: the line
 * runs down past every sibling but the last, and a curve leaves it into the row's ring. The colour is opaque (mixed into the
 * sidebar, not an alpha): the curve's antialiased start overlaps the trunk, and a translucent stroke would brighten every overlap.
 */
export function SubThreadGuide({ isLast, className }: { isLast: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn('pointer-events-none absolute inset-y-0 left-0', className)}>
      {/* Stops where the curve starts on the last row; elsewhere runs 2px on to meet the next row's trunk across the list's gap. */}
      <span className={cn('absolute top-0 left-0 border-l', GUIDE, isLast ? 'h-2.5' : '-bottom-0.5')} />
      {/* Lands at 16px, mid first line (6px padding + half of 20px). */}
      <span className={cn('absolute top-2.5 left-0 h-1.5 w-2.5 rounded-bl-[6px] border-b border-l', GUIDE)} />
    </span>
  );
}

const GUIDE = 'border-[color-mix(in_oklab,var(--subtle-foreground)_40%,var(--sidebar))]';

function useOpenThread() {
  const { state, dispatch } = useHarness();
  return (thread: Thread) => {
    if (thread.spaceId !== state.spaceId) dispatch({ type: 'space', id: thread.spaceId });
    dispatch({ type: 'go', view: { kind: 'thread', id: thread.id } });
  };
}

const TONE_TEXT = { success: 'text-success', warning: 'text-warning', destructive: 'text-destructive', muted: 'text-muted-foreground' } satisfies Record<Verdict['tone'], string>;
