import type { ComponentProps, ReactNode } from 'react';
import { CheckCircle } from '@/icons';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { authorName, type ActivityEntry, type LineSlot, type Thread } from '../model';
import { useThreadPrs } from '../git/useThreadPrs';
import { IS_MAC } from '../keys';
import { Shortcut } from '../Shortcut';
import { ProgressRing } from '../ui';
import { CallList } from '../WorkLog';
import { useHarness } from '../store';
import { duration } from '../progress';
import { agentAsk, moveContext, moveFor, questionFor } from './moves';
import { useIdleVerdict, VerdictIcon } from './VerdictChip';
import { turnReport, verdictHeading, verdictTiles, type Verdict } from './verdict';

/**
 * The end of a turn, in the chat after the agent's last call: Mochi's verdict, the agent's own summary, Mochi's evidence, then
 * the agent's question with its own answers as buttons (Mochi's move only when it wrote none). Answered, it shrinks to a record of
 * what you chose: the summary, the question, your answer.
 */
export function NextMoveCard({ className, ...props }: ComponentProps<typeof Card>) {
  return <Card size="sm" role="group" aria-label="Next move" className={className} {...props} />;
}

/** The verdict, its evidence, the agent's question and options (else Mochi's move) for a thread that just went idle; null while the agent works. */
export function useNextMove(thread: Thread) {
  const prs = useThreadPrs(thread);
  const verdict = useIdleVerdict(thread);
  const { state } = useHarness();
  if (!verdict) return null;
  const states = prs.map((p) => p.state);
  const report = turnReport(thread);
  const context = moveContext(state.threads, thread);
  const move = moveFor(thread, verdict, states.map((s) => s.status), context);
  const ask = agentAsk(report);
  const question = ask?.question ?? questionFor(verdict, move, report, authorName(thread.session?.provider ?? thread.providers[0]), context);
  return { verdict, prs, report, tiles: verdictTiles(thread, states, verdict), move, ask, question, context };
}

/** Mochi's verdict as the card's title, in the sidebar chip's icon and tone. */
export function NextMoveHeader({ thread, verdict }: { thread: Thread; verdict: Verdict }) {
  return (
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        {/* The needs-you dot draws in `currentColor` and ignores className, so the tone goes on a wrapper. */}
        <span className={cn('flex size-4 shrink-0 items-center justify-center', TONE_CLASS[verdict.tone])}>
          <VerdictIcon kind={verdict.kind} className="size-4" />
        </span>
        <span className="min-w-0 truncate">{verdictHeading(verdict, thread).title}</span>
      </CardTitle>
    </CardHeader>
  );
}

const TONE_CLASS = { success: 'text-success', warning: 'text-warning', destructive: 'text-destructive', muted: 'text-muted-foreground' } satisfies Record<Verdict['tone'], string>;

export function NextMoveContent({ className, ...props }: ComponentProps<typeof CardContent>) {
  return <CardContent className={cn('flex flex-col gap-3', className)} {...props} />;
}

/** The agent's own words for what changed, from its report. */
export function NextMoveSummary({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('type-prose text-pretty', className)} {...props} />;
}

export function NextMoveQuestion({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('type-prose font-medium text-pretty', className)} {...props} />;
}

/** What you chose, under the question once the card is a record. */
export function NextMoveAnswer({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('-mt-2 type-prose text-muted-foreground', className)} {...props} />;
}

/** An answered card, kept in the chat: the summary dimmed, the question, what you chose (none when you wrote instead). */
export function NextMoveRecord({ record }: { record: NonNullable<ActivityEntry['nextMove']> }) {
  return (
    <NextMoveCard aria-label="Next move, answered">
      <NextMoveContent>
        {!!record.summary && <NextMoveSummary className="text-muted-foreground">{record.summary}</NextMoveSummary>}
        <NextMoveQuestion>{record.question}</NextMoveQuestion>
        {!!record.answer && <NextMoveAnswer>{record.answer}</NextMoveAnswer>}
      </NextMoveContent>
    </NextMoveCard>
  );
}

/** The question and its answers on one line; the answers wrap under it when the chat is narrow. */
export function NextMoveAsk({ question, children }: { question: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <NextMoveQuestion className="min-w-0 flex-1 basis-56">{question}</NextMoveQuestion>
      {!!children && <div className="ml-auto flex shrink-0 items-center gap-1.5">{children}</div>}
    </div>
  );
}

/** The answers, the first as the primary with its shortcut, the others quieter before it. */
export function NextMoveActions({ labels, onPick }: { labels: string[]; onPick: (index: number) => void }) {
  const [primary, ...others] = labels;
  return (
    <>
      {others.map((label, i) => (
        <Button key={label} size="sm" variant="ghost" onClick={() => onPick(i + 1)}>
          {label}
        </Button>
      ))}
      <Button size="sm" onClick={() => onPick(0)} aria-keyshortcuts={IS_MAC ? 'Meta+Enter' : 'Control+Enter'}>
        {primary}
        <span aria-hidden className="contents">
          <Shortcut keys={['mod', 'Enter']} className="ml-0.5 opacity-70 [&_[data-slot=kbd]]:bg-primary-foreground/15 [&_[data-slot=kbd]]:text-primary-foreground" />
        </span>
      </Button>
    </>
  );
}

export interface PlanItem {
  title: string;
  status: 'done' | 'running' | 'pending';
  /** On Mochi's clock (`state.now`), from start to done or to now; none until it starts. */
  minutes?: number;
}

/** The agent's own to-do list, each step with how long it took; kept visible after completion. The running step spins only while `isWorking`. */
export function PlanList({ items, slot, isWorking }: { items: PlanItem[]; slot: LineSlot; isWorking: boolean }) {
  if (!items.length) return null;
  return (
    <CallList aria-label="Plan" className="divide-y-0 py-1">
      {items.map((item) => (
        <PlanRow key={item.title} item={item} slot={slot} isWorking={isWorking} />
      ))}
    </CallList>
  );
}

function PlanRow({ item, slot, isWorking }: { item: PlanItem; slot: LineSlot; isWorking: boolean }) {
  return (
    <li className="flex h-9 min-w-0 items-center gap-2.5 px-3 type-meta">
      <PlanIcon status={item.status} slot={slot} isWorking={isWorking} />
      {item.status === 'running' ? (
        <Shimmer as="span" className="min-w-0 flex-1 truncate">
          {item.title}
        </Shimmer>
      ) : (
        <span className={cn('min-w-0 flex-1 truncate', item.status === 'done' ? 'text-muted-foreground' : 'text-foreground/75')}>{item.title}</span>
      )}
      <span className="sr-only">{STATUS_LABEL[item.status]}</span>
      {item.minutes !== undefined && <span className={cn('shrink-0 tabular-nums', item.status === 'running' ? 'text-foreground/75' : 'text-subtle-foreground')}>{planDuration(item.minutes)}</span>}
    </li>
  );
}

function planDuration(minutes: number) {
  const whole = Math.round(minutes);
  return whole < 1 ? '<1m' : duration(whole);
}

function PlanIcon({ status, slot, isWorking }: { status: PlanItem['status']; slot: LineSlot; isWorking: boolean }) {
  if (status === 'done') return <CheckCircle aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />;
  if (status === 'running') return <ProgressRing met={0} total={1} slot={slot} size={14} isWorking={isWorking} />;
  return <span aria-hidden className="m-px size-3 shrink-0 rounded-full border border-dashed border-subtle-foreground" />;
}

const STATUS_LABEL = { done: ', done', running: ', in progress', pending: ', up next' } satisfies Record<PlanItem['status'], string>;
