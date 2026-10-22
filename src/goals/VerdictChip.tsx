import { Check, DiagramTree, Pause, WarningAlt } from '@/icons';
import { REF_CHIP_CLASS } from '@/icons/github';
import { cn } from '@/lib/utils';
import { useThreadPrs } from '../git/useThreadPrs';
import type { LineSlot, Thread } from '../model';
import { lineColor } from '../ui';
import { isWorking } from '../agentPhase';
import { goalProgress } from '../progress';
import { shallowEqual, useHarnessSelector } from '../store';
import { subThreadsOf } from '../reorder';
import { idleVerdict, subThreadVerdicts, type Verdict, type VerdictKind } from './verdict';

/** The thread's idle verdict with its PRs as GitHub last reported them and its sub-threads' own; null while the agent works or once settled. */
export function useIdleVerdict(thread: Thread) {
  const prs = useThreadPrs(thread);
  const subs = useHarnessSelector((s) => subThreadsOf(s.threads, thread.id), shallowEqual);
  if (thread.status === 'settled') return null;
  return idleVerdict(
    thread,
    prs.map((p) => p.state),
    subThreadVerdicts(subs, thread.id),
  );
}

/** A thread's one status, for its ring: criteria met, the verdict's tone and word (live threads; a demo thread has needs-you only), working or not. */
export function useThreadStatus(thread: Thread) {
  const verdict = useIdleVerdict(thread);
  const shown = thread.live && verdict && verdict.kind !== 'idle' && verdict.kind !== 'checking' ? verdict : null;
  const working = isWorking(thread);
  const needsYou = thread.status === 'needs-you';
  const tone = working ? null : (shown?.tone ?? (needsYou ? 'warning' : null));
  const status = working ? 'Working' : (shown?.chip ?? (needsYou ? 'Needs you' : 'Idle'));
  return { progress: goalProgress(thread), verdict: shown, tone, status, isWorking: working };
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
  if (kind === 'waiting') return <DiagramTree aria-hidden className={className} />;
  return null;
}

/**
 * A thread's one status mark: criteria met as filled segments, in the verdict's tone; the arc spinning in the line colour
 * while the agent works; a hollow muted ring with no verdict (a chat, or nothing to say yet).
 */
export function StatusRing({ met, total, tone, isWorking, slot, label, className }: { met: number; total: number; tone: Verdict['tone'] | null; isWorking: boolean; slot: LineSlot; label: string; className?: string }) {
  const segments = Math.max(1, total);
  const r = 6;
  const c = 2 * Math.PI * r;
  const gap = segments > 1 ? 1.6 : 0;
  const segment = c / segments - gap;
  const color = isWorking ? lineColor(slot) : tone ? TONE_VAR[tone] : 'var(--muted-foreground)';
  // Done with no criteria (you confirmed it) still reads as a full ring.
  const filled = tone === 'success' && total === 0 ? 1 : met;
  const fill = isWorking ? `${c / 4} ${c}` : filled ? `${Array.from({ length: filled }, () => `${segment} ${gap}`).join(' ')} 0 ${c}` : `0 ${c}`;
  // The track takes the tone too when something's wrong, so an empty ring still reads as gaps or needs-you.
  const track = !isWorking && tone && tone !== 'success' ? TONE_VAR[tone] : 'var(--muted-foreground)';
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label={label} className={cn('size-4 shrink-0 -rotate-90', isWorking && 'animate-spin motion-reduce:animate-none', className)}>
      <circle cx="8" cy="8" r={r} fill="none" stroke={track} strokeOpacity={0.35} strokeWidth="2" strokeDasharray={segments > 1 ? `${segment} ${gap}` : undefined} />
      <circle cx="8" cy="8" r={r} fill="none" stroke={color} strokeWidth="2" strokeDasharray={fill} />
    </svg>
  );
}

const TONE_VAR = { success: 'var(--success)', warning: 'var(--warning)', destructive: 'var(--destructive)', muted: 'var(--muted-foreground)' } satisfies Record<Verdict['tone'], string>;
