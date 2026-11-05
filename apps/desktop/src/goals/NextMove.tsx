import type { ComponentProps } from 'react';
import { useNow } from '../useNow';
import { Warning, CheckCircle, PauseCircle } from '@/icons';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ActivityEntry, LineSlot, Thread } from '../model';
import { ProgressRing } from '../ui';
import { CallList } from '../WorkLog';
import { useHarnessSelector } from '../store';
import { turnOf } from '../store/threads';
import { planDuration } from '../progress';
import { isPlanComplete, isTicking, planItems, type PlanItem } from './plan';
import { VerdictIcon } from './VerdictChip';
import { agentAsk, turnReport } from './report';
import { idleVerdict, TONE_CLASS, verdictTitle, type Verdict } from './verdict';

/**
 * The end of a turn, in the chat after the agent's last call: Mochi's verdict, the agent's own summary, then the agent's question
 * with its own answers as buttons. Answered, it shrinks to a record of what you chose: the summary, the question, your answer.
 */
export function NextMoveCard({
  className,
  ...props
}: ComponentProps<typeof Card>) {
  return (
    <Card
      size="sm"
      role="group"
      aria-label="Next move"
      className={cn('bg-transparent', className)}
      {...props}
    />
  );
}

/** The verdict and the agent's question and options for a thread that just went idle; null while the agent works. */
export function nextMoveOf(thread: Thread) {
  const verdict = idleVerdict(thread);
  if (!verdict) return null;
  const report = turnReport(thread);
  const ask = agentAsk(report);
  const question =
    ask?.question ?? (verdict.kind === 'needs-you' ? verdict.reason : null);
  return { verdict, report, ask, question };
}

/** Mochi's verdict as the card's title, in the sidebar chip's icon and tone. */
export function NextMoveHeader({ verdict }: { verdict: Verdict }) {
  return (
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        {/* The needs-you dot draws in `currentColor` and ignores className, so the tone goes on a wrapper. */}
        <span
          className={cn(
            'flex size-4 shrink-0 items-center justify-center',
            TONE_CLASS[verdict.tone],
          )}
        >
          <VerdictIcon kind={verdict.kind} className="size-4" />
        </span>
        <span className="min-w-0 truncate">{verdictTitle(verdict)}</span>
      </CardTitle>
    </CardHeader>
  );
}

export function NextMoveContent({
  className,
  ...props
}: ComponentProps<typeof CardContent>) {
  return (
    <CardContent className={cn('flex flex-col gap-3', className)} {...props} />
  );
}

/** The agent's recap of what changed, from its wrap_up. */
export function NextMoveSummary({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      className={cn('type-body text-pretty text-muted-foreground', className)}
      {...props}
    />
  );
}

export function NextMoveQuestion({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('type-body text-pretty', className)} {...props} />;
}

/** What you chose, under the question once the card is a record. */
export function NextMoveAnswer({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      className={cn('-mt-2 type-body text-subtle-foreground', className)}
      {...props}
    />
  );
}

/** An answered card, kept in the chat: the summary, the question, what you chose (none when you wrote instead). */
export function NextMoveRecord({
  record,
}: {
  record: NonNullable<ActivityEntry['nextMove']>;
}) {
  return (
    <NextMoveCard aria-label="Next move, answered">
      <NextMoveContent>
        {!!record.summary && (
          <NextMoveSummary>{record.summary}</NextMoveSummary>
        )}
        <NextMoveQuestion className="text-muted-foreground">
          {record.question}
        </NextMoveQuestion>
        {!!record.answer && <NextMoveAnswer>{record.answer}</NextMoveAnswer>}
      </NextMoveContent>
    </NextMoveCard>
  );
}

/**
 * The turn's plan, pinned last in the chat while the agent works on it; a running step's time ticks every second while the window
 * is visible. When the turn ends it goes, and its record (`PlanRecordRow`) stays in the transcript.
 */
export function ThreadPlan({
  thread,
  isWorking,
}: {
  thread: Thread;
  isWorking: boolean;
}) {
  const now = useHarnessSelector((s) => s.now);
  const nowMs = useNow(isWorking && thread.steps.some(isTicking) ? 1000 : null);
  if (!isWorking || thread.planTurn !== turnOf(thread)) return null;
  return (
    <PlanList
      items={planItems(thread.steps, now, nowMs, isWorking)}
      slot={thread.line}
    />
  );
}

/** The agent's own to-do list, each step with how long it took; hidden once every step is done. Only a `running` step moves. */
export function PlanList({
  items,
  slot,
}: {
  items: PlanItem[];
  slot: LineSlot;
}) {
  if (isPlanComplete(items)) return null;
  return (
    <CallList aria-label="Plan" className="divide-y-0 py-1">
      {items.map((item) => (
        <PlanRow key={item.title} item={item} slot={slot} />
      ))}
    </CallList>
  );
}

function PlanRow({ item, slot }: { item: PlanItem; slot: LineSlot }) {
  const { title, status, ms, note } = item;
  const isRunning = status === 'running';
  return (
    <li
      className="flex h-9 min-w-0 items-center gap-2.5 px-3 type-meta"
      title={note}
    >
      <PlanIcon status={status} slot={slot} />
      {isRunning ? (
        <Shimmer as="span" className="min-w-0 flex-1 truncate">
          {title}
        </Shimmer>
      ) : (
        <span className={cn('min-w-0 flex-1 truncate', TITLE_CLASS[status])}>
          {title}
        </span>
      )}
      <span className="sr-only">{STATUS_LABEL[status]}</span>
      {status === 'blocked' && (
        <span className="shrink-0 text-warning">Needs you</span>
      )}
      {ms !== undefined && (
        <span
          className={cn(
            'shrink-0 tabular-nums',
            isRunning ? 'text-foreground/75' : 'text-subtle-foreground',
          )}
        >
          {planDuration(ms, isRunning)}
        </span>
      )}
    </li>
  );
}

export function PlanIcon({
  status,
  slot,
}: {
  status: PlanItem['status'];
  slot: LineSlot;
}) {
  if (status === 'done')
    return (
      <CheckCircle
        filled
        aria-hidden
        className="size-3.5 shrink-0 text-subtle-foreground"
      />
    );
  if (status === 'running')
    return <ProgressRing slot={slot} size={14} isWorking />;
  if (status === 'paused')
    return (
      <PauseCircle
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    );
  if (status === 'blocked')
    return <Warning aria-hidden className="size-3.5 shrink-0 text-warning" />;
  return (
    <span
      aria-hidden
      className="m-px size-3 shrink-0 rounded-full border border-dashed border-subtle-foreground"
    />
  );
}

const TITLE_CLASS = {
  done: 'text-muted-foreground',
  running: '',
  paused: 'text-foreground/75',
  blocked: 'text-foreground',
  pending: 'text-foreground/75',
} satisfies Record<PlanItem['status'], string>;

const STATUS_LABEL = {
  done: ', done',
  running: ', in progress',
  paused: ', paused',
  blocked: ', needs you',
  pending: ', up next',
} satisfies Record<PlanItem['status'], string>;
