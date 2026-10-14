import { CloseCircle, Play, TickCircle } from 'reicon-react';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import { isMet, type Criterion, type Thread } from '../model';
import { useHarness } from '../store';
import { TooltipIconButton } from '../ui';
import { useWorktreePath } from '../git/worktrees';
import { checkBlockedReason, runCriterionCheck } from './checks';
import { failureLine } from './verdict';

/** What done means for a goal, one line per criterion: the agent's claim, and a check you can run when it has a command. */
export function CriteriaList({ thread, className }: { thread: Thread; className?: string }) {
  return (
    <ul aria-label="Done when" className={cn('flex flex-col gap-1', className)}>
      {(thread.criteria ?? []).map((c) => (
        <CriterionRow key={c.id} thread={thread} criterion={c} />
      ))}
    </ul>
  );
}

function CriterionRow({ thread, criterion: c }: { thread: Thread; criterion: Criterion }) {
  const isFailed = c.check?.status === 'failed';
  const Icon = isFailed ? CloseCircle : TickCircle;
  return (
    <li className="flex gap-2 type-meta text-muted-foreground">
      <Icon aria-label={isFailed ? 'Check failed' : isMet(c) ? 'Done' : 'Open'} className={cn('mt-0.5 size-3.5 shrink-0', isFailed ? 'text-destructive' : isMet(c) ? 'text-success' : 'text-subtle-foreground')} />
      <span className="flex min-w-0 flex-1 flex-col text-pretty">
        <span className={cn(isMet(c) && 'text-foreground')}>{c.text}</span>
        <CriterionEvidence criterion={c} />
      </span>
      {!!c.command && <RunCheck thread={thread} criterion={c} />}
    </li>
  );
}

function CriterionEvidence({ criterion: c }: { criterion: Criterion }) {
  if (c.check?.status === 'running') return <Shimmer as="span" className="type-caption">{`Running ${c.command}`}</Shimmer>;
  if (c.check) {
    const lastLine = failureLine(c.check.output);
    const seconds = Math.round((c.check.ms ?? 0) / 1000);
    return <span className={cn('type-caption', c.check.status === 'failed' ? 'text-destructive' : 'text-subtle-foreground')}>{c.check.status === 'passed' ? `Check passed in ${seconds}s` : `Check failed${lastLine ? `: ${lastLine}` : ''}`}</span>;
  }
  return !!c.claim && <span className="type-caption text-subtle-foreground">{c.claim.evidence}</span>;
}

function RunCheck({ thread, criterion }: { thread: Thread; criterion: Criterion }) {
  const { dispatch } = useHarness();
  useWorktreePath(thread.id); // re-renders once the worktree is made
  const reason = checkBlockedReason(thread, criterion);
  return (
    // z-10 lifts it above the summary goal block's stretched open button.
    <TooltipIconButton label="Run check" hint={reason ?? `Runs \`${criterion.command}\` in this thread's worktree`} disabled={!!reason} className="relative z-10 -my-1 size-6" onClick={() => runCriterionCheck(dispatch, thread, criterion)}>
      <Play className="size-3.5" />
    </TooltipIconButton>
  );
}
