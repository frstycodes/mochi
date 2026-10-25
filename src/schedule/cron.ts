/** A parsed five-field cron expression (minute hour day-of-month month day-of-week), in local time. */
export interface Cron {
  minutes: number[];
  hours: number[];
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  /** Classic cron: when both day fields are restricted, a day matches either one. */
  isDayOr: boolean;
}

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  {
    name: 'month',
    min: 1,
    max: 12,
    names: [
      'jan',
      'feb',
      'mar',
      'apr',
      'may',
      'jun',
      'jul',
      'aug',
      'sep',
      'oct',
      'nov',
      'dec',
    ],
  },
  {
    name: 'day of week',
    min: 0,
    max: 7,
    names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
  },
] as const;

/** Throws an Error saying which field is wrong. Supports `*`, lists, ranges, steps and month / weekday names; 7 is Sunday too. */
export function parseCron(expression: string): Cron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5)
    throw new Error(
      'A cron expression has five fields: minute hour day month weekday',
    );
  const [minutes, hours, days, months, weekdays] = parts.map((part, i) =>
    parseField(part, FIELDS[i]),
  );
  return {
    minutes: [...minutes].sort((a, b) => a - b),
    hours: [...hours].sort((a, b) => a - b),
    days,
    months,
    weekdays: new Set([...weekdays].map((d) => d % 7)),
    isDayOr: parts[2] !== '*' && parts[4] !== '*',
  };
}

export function isValidCron(expression: string) {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

function parseField(part: string, field: (typeof FIELDS)[number]) {
  const values = new Set<number>();
  const value = (text: string) => {
    const named =
      'names' in field
        ? (field.names as readonly string[]).indexOf(text.toLowerCase())
        : -1;
    const n =
      named >= 0
        ? named + (field.name === 'month' ? 1 : 0)
        : /^\d+$/.test(text)
          ? Number(text)
          : NaN;
    if (!(n >= field.min && n <= field.max))
      throw new Error(
        `"${text}" is not a valid ${field.name} (${field.min}–${field.max})`,
      );
    return n;
  };
  for (const item of part.split(',')) {
    const [range, stepText] = item.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1)
      throw new Error(
        `"${item}" has an invalid step in the ${field.name} field`,
      );
    const [from, to] =
      range === '*'
        ? [field.min, field.max]
        : range.includes('-')
          ? range.split('-').map(value)
          : [value(range), stepText === undefined ? value(range) : field.max];
    if (from > to)
      throw new Error(`"${item}" runs backwards in the ${field.name} field`);
    for (let n = from; n <= to; n += step) values.add(n);
  }
  return values;
}

// Eight years covers Feb 29 on a given weekday; anything rarer never runs.
const MAX_DAYS = 8 * 366;

/**
 * The first run strictly after `after` (epoch ms), or null if it never runs. Local wall-clock time, so DST shifts the instant:
 * a time skipped by spring-forward runs when the clock jumps (02:30 → 03:30), a time repeated by fall-back runs once (the first).
 */
export function nextRun(cron: Cron | string, after: number): number | null {
  const c = typeof cron === 'string' ? parseCron(cron) : cron;
  const start = new Date(after);
  for (let i = 0; i <= MAX_DAYS; i++) {
    const day = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + i,
    );
    if (!matchesDay(c, day)) continue;
    // Every time on a matching day, smallest first: a spring-forward time normalizes later than its neighbours, so take the minimum.
    let best: number | null = null;
    for (const h of c.hours)
      for (const m of c.minutes) {
        const at = new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          h,
          m,
        ).getTime();
        if (at > after && (best === null || at < best)) best = at;
      }
    if (best !== null) return best;
  }
  return null;
}

export function nextRuns(
  cron: Cron | string,
  after: number,
  count: number,
): number[] {
  const c = typeof cron === 'string' ? parseCron(cron) : cron;
  const runs: number[] = [];
  for (
    let at = nextRun(c, after);
    at !== null && runs.length < count;
    at = nextRun(c, at)
  )
    runs.push(at);
  return runs;
}

function matchesDay(c: Cron, day: Date) {
  if (!c.months.has(day.getMonth() + 1)) return false;
  const byDate = c.days.has(day.getDate());
  const byWeekday = c.weekdays.has(day.getDay());
  return c.isDayOr ? byDate || byWeekday : byDate && byWeekday;
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
