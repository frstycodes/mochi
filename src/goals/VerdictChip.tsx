import { Check, Pause, WarningAlt } from '@/icons';
import { REF_CHIP_CLASS } from '@/icons/github';
import { cn } from '@/lib/utils';
import { useThreadPrs } from '../git/useThreadPrs';
import type { Thread } from '../model';
import { idleVerdict, type Verdict, type VerdictKind } from './verdict';

/** The thread's idle verdict with its PRs as GitHub last reported them; null while the agent works or once settled. */
export function useIdleVerdict(thread: Thread) {
  const prs = useThreadPrs(thread);
  if (thread.status === 'settled') return null;
  return idleVerdict(
    thread,
    prs.map((p) => p.state),
  );
}

/** Done, Needs you, N gaps, Stalled: the toned chip that leads an idle thread's row. */
export function VerdictChip({ verdict, className }: { verdict: Verdict; className?: string }) {
  return (
    // pointer-events-none: decoration inside the row's button, so the chip's hover tint never fires on its own.
    <span className={cn('pointer-events-none flex h-[1.125rem] shrink-0 items-center gap-1 rounded-sm px-1.5 font-medium', REF_CHIP_CLASS[verdict.tone], className)}>
      <VerdictIcon kind={verdict.kind} />
      {verdict.chip}
    </span>
  );
}

export function VerdictIcon({ kind, className = 'size-3' }: { kind: VerdictKind; className?: string }) {
  if (kind === 'done') return <Check aria-hidden className={className} />;
  if (kind === 'gaps') return <WarningAlt aria-hidden className={className} />;
  if (kind === 'stalled') return <Pause aria-hidden className={className} />;
  if (kind === 'needs-you') return <span aria-hidden className="size-1.5 rounded-full bg-current" />;
  return null;
}
