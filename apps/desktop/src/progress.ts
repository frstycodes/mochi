import type { Step, StepStatus } from './model.ts';

export function statusAt(step: Step, t: number): StepStatus | null {
  if (step.addedAt > t) return null;
  if (step.droppedAt !== undefined && step.droppedAt <= t) return 'dropped';
  if (step.doneAt !== undefined && step.doneAt <= t) return 'done';
  const finishedLater = step.status === 'done' || step.status === 'dropped';
  if (step.startedAt !== undefined && step.startedAt <= t)
    return finishedLater ? 'running' : step.status;
  if (finishedLater || step.status === 'running') return 'ready';
  return step.status;
}

/** Each step's column on the board: its place in its thread's plan. */
export function boardColumns(lines: Step[][]): Map<string, number> {
  return new Map(
    lines.flatMap((steps) => steps.map((s, i) => [s.id, i] as const)),
  );
}

export function clock(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function duration(minutes: number) {
  return formatElapsed(minutes * 60_000, 'minutes');
}

export function shortElapsed(ms: number) {
  return formatElapsed(ms, 'short');
}

export function planDuration(ms: number, isRunning: boolean) {
  return isRunning || ms < 60_000
    ? formatElapsed(ms)
    : duration(Math.floor(ms / 60_000));
}

export function formatElapsed(
  ms: number,
  style: 'clock' | 'minutes' | 'short' | 'precise' = 'clock',
) {
  const s = Math.floor(ms / 1000);
  const m = style === 'minutes' ? ms / 60_000 : Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (style === 'precise')
    return ms < 60_000
      ? `${(ms / 1000).toFixed(1)}s`
      : `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
  if (style !== 'minutes' && s < 60) return `${s}s`;
  if (style === 'short') return m < 60 ? `${m}m` : `${h}h`;
  if (style === 'minutes')
    return m < 60 ? `${m}m` : m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return m < 60
    ? `${m}m ${String(s % 60).padStart(2, '0')}s`
    : `${h}h ${m % 60}m`;
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "just now", "1 minute ago", "3 hours ago", "yesterday" for something `minutes` old. */
export function timeAgo(minutes: number) {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return RELATIVE.format(-Math.round(minutes), 'minute');
  if (minutes < 24 * 60)
    return RELATIVE.format(-Math.round(minutes / 60), 'hour');
  return RELATIVE.format(-Math.round(minutes / (24 * 60)), 'day');
}

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'into',
  'add',
  'from',
  'that',
  'this',
  'per',
]);

export function tokens(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/s$/, '')),
  );
}

export function similarity(a: string, b: string) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size);
}
