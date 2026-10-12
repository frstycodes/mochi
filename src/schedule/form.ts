import type { MissedRuns, PrEvent, TriggerWhen } from '../host/types/schedule.ts';
import { describeCron, isValidCron, nextRuns, parseCron } from './cron.ts';

export const PRESETS = [
  { value: 'nightly', label: 'Nightly' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'custom', label: 'Cron' },
] as const;
export type Preset = (typeof PRESETS)[number]['value'];

/** What the schedule editor holds; `toWhen` turns it into a trigger, `fromWhen` reads one back. */
export interface ScheduleForm {
  kind: TriggerWhen['kind'];
  preset: Preset;
  /** `HH:MM` for nightly and weekdays. */
  time: string;
  cron: string;
  event: PrEvent;
  branch: string;
  label: string;
  missed: MissedRuns;
}

export const DEFAULT_FORM: ScheduleForm = { kind: 'cron', preset: 'nightly', time: '02:00', cron: '0 2 * * *', event: 'opened', branch: '', label: '', missed: 'run-once' };

const DAILY = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;
const WEEKDAYS = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/;
const pad = (n: string) => n.padStart(2, '0');

export function fromWhen(when: TriggerWhen, missed: MissedRuns): ScheduleForm {
  if (when.kind === 'pr') return { ...DEFAULT_FORM, kind: 'pr', event: when.event, branch: when.branch ?? '', label: when.label ?? '', missed };
  const cron = when.cron.trim().replace(/\s+/g, ' ');
  const daily = DAILY.exec(cron) ?? WEEKDAYS.exec(cron);
  const preset: Preset = cron === '0 * * * *' ? 'hourly' : DAILY.test(cron) ? 'nightly' : WEEKDAYS.test(cron) ? 'weekdays' : 'custom';
  return { ...DEFAULT_FORM, preset, cron, missed, time: daily ? `${pad(daily[2])}:${pad(daily[1])}` : DEFAULT_FORM.time };
}

/** The cron a preset stands for; the custom one is whatever was typed. */
export function formCron(form: ScheduleForm) {
  const [h, m] = form.time.split(':').map(Number);
  if (form.preset === 'hourly') return '0 * * * *';
  if (form.preset === 'nightly') return `${m} ${h} * * *`;
  if (form.preset === 'weekdays') return `${m} ${h} * * 1-5`;
  return form.cron.trim();
}

/** The trigger, or the reason the form can't make one. */
export function toWhen(form: ScheduleForm): { when: TriggerWhen } | { error: string } {
  if (form.kind === 'pr') return { when: { kind: 'pr', event: form.event, ...(form.branch.trim() && { branch: form.branch.trim() }), ...(form.label.trim() && { label: form.label.trim() }) } };
  if (form.preset !== 'hourly' && form.preset !== 'custom' && !/^\d{2}:\d{2}$/.test(form.time)) return { error: 'Pick a time' };
  const cron = formCron(form);
  try {
    parseCron(cron);
  } catch (error) {
    return { error: (error as Error).message };
  }
  return { when: { kind: 'cron', cron } };
}

/** "Every day at 02:00" and the next three runs, for the editor's preview. */
export function preview(form: ScheduleForm, now: number) {
  const cron = formCron(form);
  if (!isValidCron(cron)) return null;
  return { text: describeCron(cron), next: nextRuns(cron, now, 3) };
}
