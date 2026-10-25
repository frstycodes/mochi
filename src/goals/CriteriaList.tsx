import { Play, XCircle, CheckBadge } from '@/icons';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import { type Criterion, type Thread } from '../model';
import { useDispatch } from '../store';
import { TooltipIconButton } from '../ui';
import { useWorktreePath } from '../git/worktrees';
import { checkBlockedReason, runCriterionCheck } from './checks';
import { failureLine } from './verdict';
import { criterionState, type CriterionState } from './criteria';

/** What done means for a goal, one line per criterion: the agent's claim, and a check you can run when it has a command. */
export function CriteriaList({
  thread,
  className,
}: {
  thread: Thread;
  className?: string;
}) {
  return (
    <ul aria-label="Done when" className={cn('flex flex-col gap-1', className)}>
      {(thread.criteria ?? []).map((c) => (
        <CriterionRow key={c.id} thread={thread} criterion={c} />
      ))}
    </ul>
  );
}

function CriterionRow({
  thread,
  criterion: c,
}: {
  thread: Thread;
  criterion: Criterion;
}) {
  const state = criterionState(c, thread.idle?.isConfirmed);
  return (
    <li className="flex gap-2 type-meta text-muted-foreground">
      <CriterionIcon state={state} />
      <span className="flex min-w-0 flex-1 flex-col text-pretty">
        <span
          className={cn(
            (state === 'verified' || state === 'claimed') && 'text-foreground',
          )}
        >
          {c.text}
        </span>
        <CriterionEvidence
          criterion={c}
          isConfirmed={thread.idle?.isConfirmed}
        />
      </span>
      {!!c.command && <RunCheck thread={thread} criterion={c} />}
    </li>
  );
}

function CriterionEvidence({
  criterion: c,
  isConfirmed,
}: {
  criterion: Criterion;
  isConfirmed?: boolean;
}) {
  if (c.check?.status === 'running')
    return (
      <Shimmer
        as="span"
        className="type-caption"
      >{`Running ${c.command}`}</Shimmer>
    );
  if (c.check) {
    const lastLine = failureLine(c.check.output);
    const seconds = Math.round((c.check.ms ?? 0) / 1000);
    return (
      <span
        className={cn(
          'type-caption',
          c.check.status === 'failed'
            ? 'text-destructive'
            : 'text-subtle-foreground',
        )}
      >
        {c.check.status === 'passed'
          ? `Check passed in ${seconds}s`
          : `Check failed${lastLine ? `: ${lastLine}` : ''}`}
      </span>
    );
  }
  if (!c.command && isConfirmed)
    return (
      <span className="type-caption text-subtle-foreground">
        Verified by you
      </span>
    );
  return (
    !!c.claim && (
      <span className="type-caption text-subtle-foreground">{`Work done · ${c.claim.evidence} · awaiting verification`}</span>
    )
  );
}

export function RunCheck({
  thread,
  criterion,
  className,
}: {
  thread: Thread;
  criterion: Criterion;
  className?: string;
}) {
  const dispatch = useDispatch();
  useWorktreePath(thread.id); // re-renders once the worktree is made
  const reason = checkBlockedReason(thread, criterion);
  return (
    // z-10 lifts it above the summary goal block's stretched open button.
    <TooltipIconButton
      label="Run check"
      hint={reason ?? `Runs \`${criterion.command}\` in this thread's worktree`}
      disabled={!!reason}
      className={cn('relative z-10 -my-1 size-6', className)}
      onClick={() => runCriterionCheck(dispatch, thread, criterion)}
    >
      <Play className="size-3.5" />
    </TooltipIconButton>
  );
}

export function CriterionIcon({ state }: { state: CriterionState }) {
  const label = STATE_LABEL[state];
  if (state === 'failed')
    return (
      <XCircle
        aria-label={label}
        className="mt-0.5 size-3.5 shrink-0 text-destructive"
      />
    );
  if (state === 'verified')
    return (
      <CheckBadge
        aria-label={label}
        className="mt-0.5 size-3.5 shrink-0 text-success"
      />
    );
  if (state === 'claimed')
    return (
      <CheckBadge
        aria-label={label}
        className="mt-0.5 size-3.5 shrink-0 text-info"
      />
    );
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'mt-[3px] ml-px size-3 shrink-0 rounded-full border border-dashed border-subtle-foreground',
        state === 'running' &&
          'animate-spin border-solid border-t-transparent motion-reduce:animate-none',
      )}
    />
  );
}

const STATE_LABEL = {
  verified: 'Verified',
  claimed: 'Work done, awaiting verification',
  failed: 'Check failed',
  running: 'Check running',
  open: 'Open',
} satisfies Record<CriterionState, string>;
