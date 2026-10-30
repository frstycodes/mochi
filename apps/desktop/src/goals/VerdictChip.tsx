import { Pause } from '@/icons';
import { cn } from '@/lib/utils';
import type { LineSlot, Thread } from '../model';
import { lineColor } from '../ui';
import { isWorking } from '../agentPhase';
import { idleVerdict, type Verdict, type VerdictKind } from './verdict';

/**
 * A thread's one status, for its ring: the verdict's tone and word (live threads; a demo thread has needs-you only), working or not.
 * Needs you wins over working: a live agent stays mid-turn while it waits on your approval or answer, and that wait is what the row must say.
 */
export function threadStatus(thread: Thread) {
  const verdict = idleVerdict(thread);
  const shown =
    thread.live && verdict && verdict.kind !== 'idle' ? verdict : null;
  const needsYou = thread.status === 'needs-you';
  const working = isWorking(thread) && !needsYou;
  const tone = working ? null : (shown?.tone ?? (needsYou ? 'warning' : null));
  const status = working
    ? 'Working'
    : (shown?.chip ?? (needsYou ? 'Needs you' : 'Idle'));
  return { verdict: shown, tone, status, isWorking: working };
}

export function VerdictIcon({
  kind,
  className = 'size-3',
}: {
  kind: VerdictKind;
  className?: string;
}) {
  if (kind === 'stalled') return <Pause aria-hidden className={className} />;
  if (kind === 'needs-you')
    return <span aria-hidden className="size-1.5 rounded-full bg-current" />;
  return null;
}

/**
 * A thread's one status mark: the arc spinning in the line colour while the agent works; a ring in the verdict's tone when it
 * asks for you or stalled; a hollow muted ring with no verdict (a chat, or nothing to say yet).
 */
export function StatusRing({
  tone,
  isWorking,
  slot,
  label,
  className,
}: {
  tone: Verdict['tone'] | null;
  isWorking: boolean;
  slot: LineSlot;
  label: string;
  className?: string;
}) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const color = isWorking ? lineColor(slot) : 'var(--muted-foreground)';
  // The track takes the tone when something's wrong, so the ring still reads as needs-you or stalled.
  const track = !isWorking && tone ? TONE_VAR[tone] : 'var(--muted-foreground)';
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
      className={cn(
        'size-4 shrink-0 -rotate-90',
        isWorking && 'animate-spin motion-reduce:animate-none',
        className,
      )}
    >
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke={track}
        strokeOpacity={0.35}
        strokeWidth="2"
      />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={isWorking ? `${c / 4} ${c}` : `0 ${c}`}
      />
    </svg>
  );
}

const TONE_VAR = {
  warning: 'var(--warning)',
  destructive: 'var(--destructive)',
  muted: 'var(--muted-foreground)',
} satisfies Record<Verdict['tone'], string>;
