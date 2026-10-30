/** When a snoozed thread wakes: "9:00 AM" today, "tomorrow 9:00 AM", else "Mon 9:00 AM". */
export function wakeLabel(at: number, now = new Date()) {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (date.toDateString() === now.toDateString()) return time;
  if (date.toDateString() === tomorrow.toDateString())
    return `tomorrow ${time}`;
  return `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

const HOUR_MS = 3_600_000;

/** The Snooze menu's times: three hours on, tomorrow 9 AM, next Monday 9 AM. */
export function snoozeTimes(now = new Date()) {
  const morning = (daysAhead: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  };
  const daysToMonday = (8 - now.getDay()) % 7 || 7;
  return [
    { label: 'Later today', at: now.getTime() + 3 * HOUR_MS },
    { label: 'Tomorrow', at: morning(1) },
    { label: 'Next week', at: morning(daysToMonday) },
  ];
}
