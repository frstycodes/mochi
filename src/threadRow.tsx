import { Hierarchy } from '@/icons';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/format';
import type { Thread } from './model';
import { workingLabel } from './agentPhase';
import { limitStatus } from './chat/LimitCard';
import { useThreadStatus } from './goals/VerdictChip';
import { NEXT_STEP_TITLES, reportHeadline } from './goals/report';
import { runningBackground } from './runtime/subagents';
import { useHarnessSelector } from './store';
import { isUnread } from './store/seen';
import { LiveDot } from './ui';

export type ThreadRow = ReturnType<typeof useThreadRow>;

/** A row's one status (`useThreadStatus`) and the line under its title: the verdict's reason when idle, else the step in flight or what it waits for. */
export function useThreadRow(thread: Thread) {
  const question = useHarnessSelector(
    (s) => s.queue.find((q) => q.threadId === thread.id)?.title,
  );
  const isWatched = useHarnessSelector((s) => s.watched.includes(thread.id));
  const status = useThreadStatus(thread);
  const detail =
    !status.isWorking && status.verdict
      ? status.verdict.reason
      : threadDetail(thread, question);
  return { ...status, detail, isUnread: isUnread(thread), isWatched };
}

export function threadDetail(thread: Thread, question?: string) {
  const limit = limitStatus(thread);
  if (limit) return limit;
  if (thread.status === 'needs-you') return question ?? 'Waiting on you';
  if (thread.status === 'settled') return 'Archived';
  const pr = thread.prs[thread.prs.length - 1];
  if (thread.status === 'review')
    return pr ? `#${pr.number} ready for review` : NEXT_STEP_TITLES['open-pr'];
  // A live agent reports what it's doing; idle, its last report says where things stand; demo threads are told by their goal steps.
  if (thread.live)
    return workingLabel(thread) ?? reportHeadline(thread) ?? 'Idle';
  const step =
    thread.steps.find((s) => s.status === 'running') ??
    thread.steps.find((s) => s.status === 'ready');
  return step?.title ?? 'Idle';
}

/**
 * A thread row's one status, at the title line's end: a quiet pulse while working, else a dot for what asks for you (needs you,
 * failed), else blue for unread; nothing for an idle thread you've seen.
 */
export function ThreadStatusDot({
  row,
  isActive,
  className,
}: {
  row: ThreadRow;
  isActive?: boolean;
  className?: string;
}) {
  if (row.isWorking)
    return (
      <span
        role="img"
        aria-label="Working"
        className={cn('flex shrink-0', className)}
      >
        <LiveDot className="size-1.5 text-muted-foreground" />
      </span>
    );
  const dot =
    row.tone === 'warning' || row.tone === 'destructive'
      ? row.tone
      : row.isUnread && !isActive
        ? 'unread'
        : null;
  if (!dot) return null;
  return (
    <span
      role="img"
      aria-label={dot === 'unread' ? 'Unread' : row.status}
      className={cn('size-1.5 shrink-0 rounded-full', DOT_BG[dot], className)}
    />
  );
}

const DOT_BG = {
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  unread: 'bg-unread',
} satisfies Record<string, string>;

/** How many background agents the thread has running; nothing when none do. */
export function AgentsBadge({ thread }: { thread: Thread }) {
  const running = runningBackground(thread);
  if (!running) return null;
  const label = plural(
    running,
    '1 background agent running',
    `${running} background agents running`,
  );
  return (
    <span
      aria-label={label}
      title={label}
      className="flex shrink-0 items-center gap-0.5 tabular text-muted-foreground"
    >
      <Hierarchy aria-hidden className="size-3" />
      {running}
    </span>
  );
}
