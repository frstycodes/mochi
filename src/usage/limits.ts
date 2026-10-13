import type { LimitWindow } from '../host/types/agent.ts';

// Imported by main and the renderer: provider payloads in, `LimitWindow`s out.

const CLAUDE_WINDOWS = {
  five_hour: '5-hour',
  seven_day: 'Weekly',
  seven_day_opus: 'Weekly · Opus',
  seven_day_sonnet: 'Weekly · Sonnet',
} as const satisfies Record<string, string>;

type ClaudeWindowId = keyof typeof CLAUDE_WINDOWS;
const isClaudeWindow = (id: string | undefined): id is ClaudeWindowId => !!id && id in CLAUDE_WINDOWS;

/** Claude's `rate_limit_event.rate_limit_info`: one window per event, `utilization` 0–1 (the CLI reads it from the `-utilization` header and shows ×100), `resetsAt` unix seconds. */
export function claudeEventWindow(info: { status: string; rateLimitType?: string; utilization?: number; resetsAt?: number }): LimitWindow | null {
  if (!isClaudeWindow(info.rateLimitType)) return null;
  const usedPct = info.utilization !== undefined ? info.utilization * 100 : info.status === 'rejected' ? 100 : null;
  if (usedPct === null) return null;
  return { id: info.rateLimitType, label: CLAUDE_WINDOWS[info.rateLimitType], usedPct: clampPct(usedPct), ...(info.resetsAt !== undefined && { resetsAt: unixToIso(info.resetsAt) }) };
}

type ClaudeUsageWindow = { utilization: number | null; resets_at: string | null } | null | undefined;

/**
 * The SDK's `get_usage` read (`rate_limits`, utilization 0–100, ISO resets), the full set at once. Model-specific weekly
 * windows arrive as `model_scoped` (a real Max account listed "Fable" there, `weekly_scoped` in its `limits`, with
 * `seven_day_opus` / `seven_day_sonnet` null).
 */
export function claudeUsageWindows(limits: Record<string, unknown> | null): LimitWindow[] {
  if (!limits) return [];
  const named = Object.keys(CLAUDE_WINDOWS).flatMap((id) => usageWindow(id, CLAUDE_WINDOWS[id as ClaudeWindowId], limits[id] as ClaudeUsageWindow));
  const scoped = Array.isArray(limits.model_scoped) ? (limits.model_scoped as ({ display_name: string } & NonNullable<ClaudeUsageWindow>)[]) : [];
  const models = scoped.flatMap((w) => usageWindow(`model:${w.display_name}`, `Weekly · ${w.display_name}`, w));
  return [...named, ...models.filter((m) => !named.some((n) => n.label === m.label))];
}

function usageWindow(id: string, label: string, w: ClaudeUsageWindow): LimitWindow[] {
  if (!w || w.utilization === null) return [];
  return [{ id, label, usedPct: clampPct(w.utilization), ...(w.resets_at && { resetsAt: w.resets_at }) }];
}

type CodexWindow = { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null } | null | undefined;

/** Codex's `RateLimitSnapshot` (`account/rateLimits/read` / `updated`): primary and secondary, labelled by their real length, so a plan with only a weekly window shows only that. */
export function codexWindows(snapshot: { primary?: CodexWindow; secondary?: CodexWindow } | null | undefined): LimitWindow[] {
  return (['primary', 'secondary'] as const).flatMap((id) => {
    const w = snapshot?.[id];
    if (!w || typeof w.usedPercent !== 'number') return [];
    return [{ id, label: durationLabel(w.windowDurationMins), usedPct: clampPct(w.usedPercent), ...(w.resetsAt !== null && { resetsAt: unixToIso(w.resetsAt) }) }];
  });
}

export function durationLabel(minutes: number | null) {
  if (!minutes) return 'Usage';
  if (minutes === 7 * 24 * 60) return 'Weekly';
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}-day`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour`;
  return `${minutes}-minute`;
}

/** Updates are sparse: an incoming window replaces the one with its id, the rest stay. Shortest window first. */
export function mergeWindows(known: LimitWindow[], incoming: LimitWindow[]) {
  const byId = new Map(known.map((w) => [w.id, w]));
  for (const w of incoming) byId.set(w.id, w);
  return [...byId.values()].sort((a, b) => order(a) - order(b));
}

const ORDER = ['five_hour', 'primary', 'secondary', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];
// Model windows (`model:<name>`) sort after the named ones.
const order = (w: LimitWindow) => (ORDER.includes(w.id) ? ORDER.indexOf(w.id) : ORDER.length);

export type Tone = 'normal' | 'warning' | 'destructive';

/** Shared by the context ring and the limit bars: under 70% normal, 70–90% warning, above 90% destructive. `share` is 0–1. */
export function toneFor(share: number): Tone {
  if (share > 0.9) return 'destructive';
  if (share >= 0.7) return 'warning';
  return 'normal';
}

export const TONE_COLORS = { normal: 'var(--muted-foreground)', warning: 'var(--warning)', destructive: 'var(--destructive)' } satisfies Record<Tone, string>;

/** "2h 14m", "3d 4h", "45m"; "now" once past. */
export function untilLabel(ms: number) {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 0) return 'now';
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

const clampPct = (pct: number) => Math.min(100, Math.max(0, pct));
const unixToIso = (value: number) => new Date(value < 1e12 ? value * 1000 : value).toISOString();
