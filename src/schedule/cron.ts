import { Cron, Result } from 'effect';

const FIELD_NAMES = [
  'minute',
  'hour',
  'day of month',
  'month',
  'day of week',
] as const;

// Parsed in the zone the machine is in now: without one the library steps through a DST change at the old offset.
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Throws an Error saying which field is wrong. Five fields (minute hour day month weekday), local time; `Cron.parse`
 * would also take a leading seconds field, which a schedule must not have.
 */
export function parseCron(expression: string): Cron.Cron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5)
    throw new Error(
      'A cron expression has five fields: minute hour day month weekday',
    );
  const parsed = Cron.parse(parts.join(' '), localZone());
  if (Result.isSuccess(parsed)) return parsed.success;
  const field = parts.findIndex((part, i) =>
    Result.isFailure(
      Cron.parse(parts.map((_, j) => (i === j ? part : '*')).join(' ')),
    ),
  );
  throw new Error(
    field < 0
      ? parsed.failure.message
      : `The ${FIELD_NAMES[field]} field "${parts[field]}": ${parsed.failure.message}`,
  );
}

export function isValidCron(expression: string) {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

/** The first run strictly after `after` (epoch ms), or null if it never runs (Feb 30). */
export function nextRun(expression: string, after: number): number | null {
  try {
    return Cron.next(parseCron(expression), after).getTime();
  } catch {
    return null;
  }
}

export function nextRuns(
  expression: string,
  after: number,
  count: number,
): number[] {
  const runs: number[] = [];
  for (
    let at = nextRun(expression, after);
    at !== null && runs.length < count;
    at = nextRun(expression, at)
  )
    runs.push(at);
  return runs;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

/** A plain-words reading of common shapes; anything else reads "Custom schedule" and leans on the next-run preview. */
export function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 || !isValidCron(expression))
    return 'Not a valid schedule';
  const [min, hour, dom, month, dow] = parts;
  const isNum = (s: string) => /^\d+$/.test(s);
  const time =
    isNum(min) && isNum(hour)
      ? `${pad(Number(hour))}:${pad(Number(min))}`
      : null;
  if (month !== '*') return 'Custom schedule';
  if (min === '*' && hour === '*' && dom === '*' && dow === '*')
    return 'Every minute';
  const everyMinutes = /^\*\/(\d+)$/.exec(min);
  if (everyMinutes && hour === '*' && dom === '*' && dow === '*')
    return `Every ${everyMinutes[1]} minutes`;
  if (isNum(min) && hour === '*' && dom === '*' && dow === '*')
    return `Every hour at :${pad(Number(min))}`;
  if (!time) return 'Custom schedule';
  if (dom === '*' && dow === '*') return `Every day at ${time}`;
  if (dom === '*' && dow === '1-5') return `Weekdays at ${time}`;
  if (dom === '*' && /^[0-7](,[0-7])*$/.test(dow))
    return `${[...new Set(dow.split(',').map((d) => WEEKDAY_NAMES[Number(d) % 7]))].join(', ')} at ${time}`;
  if (isNum(dom) && dow === '*') return `Monthly on day ${dom} at ${time}`;
  return 'Custom schedule';
}

/** "02:00" today, "Tue 02:00" within a week, else "Oct 20 02:00". */
export function shortRunTime(at: number, now: number) {
  const d = new Date(at);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (new Date(now).toDateString() === d.toDateString()) return time;
  if (at - now < 6 * 24 * 60 * 60_000)
    return `${WEEKDAY_NAMES[d.getDay()]} ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}
