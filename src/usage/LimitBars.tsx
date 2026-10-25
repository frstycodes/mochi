import type { CSSProperties } from 'react';
import { Progress } from '@/components/ui/progress';
import type { AccountLimits, LimitWindow } from '../host/types/agent.ts';
import { timeAgo } from '../progress.ts';
import { useNow } from '../useNow.ts';
import { TONE_COLORS, toneFor, untilLabel } from './limits.ts';

/** One bar per plan window the account reported, with when it resets; nothing for a window the plan doesn't have. */
export function LimitBars({ limits }: { limits: AccountLimits | null }) {
  const now = useNow(60_000);
  if (!limits) return <p className="type-caption text-subtle-foreground">Reading plan limits…</p>;
  if (!limits.windows.length) return <p className="type-caption text-subtle-foreground">No plan limits reported yet. They appear after the first reply on this account.</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {limits.windows.map((w) => (
        <LimitBar key={w.id} window={w} now={now} />
      ))}
    </ul>
  );
}

function LimitBar({ window: w, now }: { window: LimitWindow; now: number }) {
  const tone = toneFor(w.usedPct / 100);
  const pct = Math.round(w.usedPct);
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 type-caption">
        <span className="text-foreground">{w.label}</span>
        <span className="tabular text-muted-foreground" style={{ color: tone === 'normal' ? undefined : TONE_COLORS[tone] }}>
          {pct}% used
        </span>
      </div>
      <Progress value={pct} className="bg-muted-foreground/20" aria-label={`${w.label} limit: ${pct}% used`} style={{ '--progress-color': TONE_COLORS[tone] } as CSSProperties} />
      {!!w.resetsAt && <ResetTime at={new Date(w.resetsAt)} now={now} />}
    </li>
  );
}

const SAME_DAY = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const OTHER_DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

function ResetTime({ at, now }: { at: Date; now: number }) {
  const isToday = at.toDateString() === new Date(now).toDateString();
  return (
    <span className="tabular type-caption text-subtle-foreground">
      Resets in {untilLabel(at.getTime() - now)} · <time dateTime={at.toISOString()}>{(isToday ? SAME_DAY : OTHER_DAY).format(at)}</time>
    </span>
  );
}

/** "Updated 3 minutes ago", or nothing before the provider ever reported. */
export function UpdatedAt({ limits }: { limits: AccountLimits | null }) {
  const now = useNow(60_000);
  if (!limits?.updatedAt) return null;
  return <span className="type-caption text-subtle-foreground">Updated {timeAgo((now - Date.parse(limits.updatedAt)) / 60_000)}</span>;
}
