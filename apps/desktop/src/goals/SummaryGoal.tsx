import type { ComponentProps, ReactNode } from 'react';
import { ChevronRight, Edit, Maximize, CheckBadge } from '@/icons';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import { authorName, isMet, type Criterion, type Thread } from '../model';
import { isWorking } from '../agentPhase';
import { ProgressRing, TooltipIconButton } from '../ui';
import { criterionState, type CriterionState } from './criteria';
import { CriterionIcon, RunCheck } from './CriteriaList';
import { HandedCriterion } from './SubThreads';
import { subThreadsOf } from '../reorder';
import { useHarness } from '../store';
import { VerdictIcon } from './VerdictChip';
import { failureLine, verdictHeading, type Verdict } from './verdict';

/**
 * The goal at the top of the summary: Mochi's verdict (the sidebar chip's words), the outcome, then what done means with each
 * criterion's proof, verified by Mochi or only claimed by the agent. The agent's plan lives at the bottom of the chat, not here.
 */
export function SummaryGoal({
  className,
  ...props
}: ComponentProps<'section'>) {
  return (
    <section
      aria-label="Goal"
      className={cn('flex flex-col gap-2.5 rounded-lg px-2 py-2', className)}
      {...props}
    />
  );
}

/** "Goal", edit and open beside it, then what done means counted on the right, where a drag handle may cover it. */
export function SummaryGoalHeader({
  thread,
  onEdit,
  onOpen,
  countClassName,
}: {
  thread: Thread;
  onEdit: () => void;
  onOpen: () => void;
  countClassName?: string;
}) {
  const criteria = thread.criteria ?? [];
  const met = criteria.filter((c) => isMet(c, thread.idle?.isConfirmed)).length;
  return (
    <div className="flex items-center gap-1">
      <h2 className="mr-1 type-title">Goal</h2>
      <TooltipIconButton
        label="Edit goal"
        hint="Change the outcome or what done means"
        size="icon-xs"
        onClick={onEdit}
      >
        <Edit />
      </TooltipIconButton>
      <TooltipIconButton
        label="Open the goal"
        hint="History, the agent's notes, every check"
        size="icon-xs"
        onClick={onOpen}
      >
        <Maximize />
      </TooltipIconButton>
      {criteria.length > 0 && (
        <span
          className={cn(
            'ml-auto flex items-center gap-1.5 tabular type-caption text-subtle-foreground',
            countClassName,
          )}
        >
          <ProgressRing
            met={met}
            total={criteria.length}
            slot={thread.line}
            size={14}
            isWorking={isWorking(thread)}
          />
          {`${met} of ${criteria.length}`}
        </span>
      )}
    </div>
  );
}

/** Idle: the verdict in the sidebar chip's icon, tone and words. Working: the ring spins and the step in flight shimmers. Settled says so. */
export function SummaryGoalStatus({
  thread,
  verdict,
  step,
}: {
  thread: Thread;
  verdict: Verdict | null;
  step?: string;
}) {
  const working = isWorking(thread);
  if (
    !working &&
    (!verdict || verdict.kind === 'idle') &&
    thread.status !== 'settled'
  )
    return null;
  if (thread.status === 'settled')
    return (
      <StatusLine
        icon={<CheckBadge className="size-3.5 text-subtle-foreground" />}
      >
        Settled
      </StatusLine>
    );
  if (verdict && !working)
    return (
      <StatusLine
        icon={
          <span
            className={cn(
              'flex size-3.5 items-center justify-center',
              TONE_CLASS[verdict.tone],
            )}
          >
            <VerdictIcon kind={verdict.kind} className="size-3.5" />
          </span>
        }
      >
        {verdictHeading(verdict, thread).title}
      </StatusLine>
    );
  return (
    <StatusLine
      icon={
        <ProgressRing
          met={0}
          total={1}
          slot={thread.line}
          size={14}
          isWorking
        />
      }
    >
      {step ? (
        <Shimmer as="span" className="font-normal">
          {step}
        </Shimmer>
      ) : (
        'Working'
      )}
    </StatusLine>
  );
}

function StatusLine({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <p className="flex min-w-0 items-center gap-2 type-meta font-medium">
      <span aria-hidden className="flex shrink-0">
        {icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </p>
  );
}

const TONE_CLASS = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
} satisfies Record<Verdict['tone'], string>;

/** The outcome itself, the panel's headline. */
export function SummaryGoalText({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      className={cn('line-clamp-3 type-body text-pretty', className)}
      {...props}
    />
  );
}

/** What done means: one row per criterion, its proof under it, Run on the ones Mochi can check. */
export function SummaryCriteria({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  if (!thread.criteria?.length) return null;
  // A criterion handed to a sub-thread shows that sub-thread until it's met here.
  const handedTo = (c: Criterion) =>
    isMet(c, thread.idle?.isConfirmed)
      ? undefined
      : subThreadsOf(state.threads, thread.id).find(
          (t) => t.parent?.criterionId === c.id && t.status !== 'settled',
        );
  return (
    <ul aria-label="Done when" className="flex flex-col gap-1.5">
      {thread.criteria.map((c) => {
        const sub = handedTo(c);
        return sub ? (
          <HandedCriterion key={c.id} criterion={c} sub={sub} />
        ) : (
          <SummaryCriterion key={c.id} thread={thread} criterion={c} />
        );
      })}
    </ul>
  );
}

function SummaryCriterion({
  thread,
  criterion: c,
}: {
  thread: Thread;
  criterion: Criterion;
}) {
  const state = criterionState(c, thread.idle?.isConfirmed);
  return (
    <li className="group/criterion flex gap-2 type-meta">
      <CriterionIcon state={state} />
      <span className="flex min-w-0 flex-1 flex-col text-pretty">
        <span
          className={cn(
            state === 'open' || state === 'claimed'
              ? 'text-foreground/75'
              : 'text-foreground',
          )}
        >
          {c.text}
        </span>
        <CriterionProof
          criterion={c}
          state={state}
          agent={authorName(thread.session?.provider ?? thread.providers[0])}
        />
      </span>
      {!!c.command && state !== 'running' && (
        <RunCheck
          thread={thread}
          criterion={c}
          className="opacity-0 group-hover/criterion:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        />
      )}
    </li>
  );
}

function CriterionProof({
  criterion: c,
  state,
  agent,
}: {
  criterion: Criterion;
  state: CriterionState;
  agent: string;
}) {
  if (state === 'running')
    return (
      <Shimmer
        as="span"
        className="type-caption"
      >{`Running ${c.command}`}</Shimmer>
    );
  if (state === 'failed')
    return (
      <Proof className="text-destructive">{`Check failed${failureLine(c.check?.output) ? `: ${failureLine(c.check?.output)}` : ''}`}</Proof>
    );
  if (state === 'verified')
    return (
      <Proof>
        {c.check?.status === 'passed'
          ? `Verified by Mochi in ${Math.round((c.check.ms ?? 0) / 1000)}s`
          : 'Verified by you'}
      </Proof>
    );
  if (state === 'claimed')
    return (
      <>
        <Proof className="text-info">Work done · awaiting verification</Proof>
        <Proof>{`${agent}: ${c.claim!.evidence}`}</Proof>
      </>
    );
  return <Proof>{c.command ? 'Not checked yet' : 'You check this one'}</Proof>;
}

function Proof({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'line-clamp-2 type-caption text-subtle-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The end-of-turn question while it waits for you; opens the card in the chat rather than answering here. */
export function SummaryNextMove({
  question,
  onShow,
}: {
  question: string;
  onShow: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onShow}
      className="group/next flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2 py-1.5 text-left type-meta hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none"
    >
      <span
        aria-hidden
        className="flex h-5 w-3.5 shrink-0 items-center justify-center"
      >
        <span className="size-1.5 rounded-full bg-warning" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-pretty">{question}</span>
        <span className="type-caption text-subtle-foreground">
          Answer in the chat
        </span>
      </span>
      <ChevronRight
        aria-hidden
        className="mt-1 size-3 shrink-0 text-subtle-foreground"
      />
    </button>
  );
}
