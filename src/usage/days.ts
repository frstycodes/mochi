/** `YYYY-MM-DD` in the computer's own time zone, the day a person would say it happened. */
export function localDay(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Every local day from `first` to `last`, both included. */
export function daysBetween(first: string, last: string): string[] {
  const days: string[] = [];
  const d = new Date(`${first}T12:00:00`);
  while (localDay(d.getTime()) <= last) {
    days.push(localDay(d.getTime()));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/** "Mon, Oct 13" for a day, "Week of Oct 13" for a week's Monday. */
export function periodName(key: string, isWeekly: boolean) {
  const d = new Date(`${key}T12:00:00`);
  if (isWeekly) return `Week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
