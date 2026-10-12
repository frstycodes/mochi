import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PR_EVENTS, type MissedRuns, type PrEvent } from '../host/types/schedule';
import { SettingsChoice, SettingsSelect, settingControlId } from '../settings/parts';
import { shortRunTime } from './cron';
import { PR_EVENT_LABELS } from './due';
import { PRESETS, preview, toWhen, type Preset, type ScheduleForm } from './form';

const KINDS = [
  { value: 'cron', label: 'Schedule' },
  { value: 'pr', label: 'Pull request' },
] as const;

const MISSED = [
  { value: 'run-once', label: 'Run once on launch' },
  { value: 'skip', label: 'Skip them' },
] satisfies { value: MissedRuns; label: string }[];

const EVENTS = PR_EVENTS.map((value) => ({ value, label: `${PR_EVENT_LABELS[value][0].toUpperCase()}${PR_EVENT_LABELS[value].slice(1)}` }));

/** The when of a trigger: a cron schedule (presets or an expression, previewed with its next runs) or a polled pull request event. */
export function ScheduleFields({ form, onChange, id }: { form: ScheduleForm; onChange: (form: ScheduleForm) => void; id: string }) {
  const set = (patch: Partial<ScheduleForm>) => onChange({ ...form, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <SettingsChoice id={`${id}-kind`} aria-label="Trigger" value={form.kind} options={KINDS} onChange={(kind) => set({ kind })} />
      {form.kind === 'cron' ? <CronFields form={form} set={set} id={id} /> : <PrFields form={form} set={set} id={id} />}
    </div>
  );
}

function CronFields({ form, set, id }: { form: ScheduleForm; set: (patch: Partial<ScheduleForm>) => void; id: string }) {
  const hasTime = form.preset === 'nightly' || form.preset === 'weekdays';
  return (
    <>
      <SettingsChoice id={`${id}-preset`} aria-label="Repeat" value={form.preset} options={PRESETS} onChange={(preset: Preset) => set({ preset })} />
      {hasTime && (
        <Field orientation="horizontal">
          <FieldLabel htmlFor={`${id}-time`} className="w-24 shrink-0">
            At
          </FieldLabel>
          <Input id={`${id}-time`} type="time" required value={form.time} onChange={(e) => set({ time: e.target.value })} className="w-28 tabular" />
        </Field>
      )}
      {form.preset === 'custom' && (
        <Field>
          <FieldLabel htmlFor={`${id}-cron`}>Cron expression</FieldLabel>
          <Input id={`${id}-cron`} value={form.cron} onChange={(e) => set({ cron: e.target.value })} placeholder="0 2 * * *" spellCheck={false} autoComplete="off" aria-invalid={'error' in toWhen(form)} aria-describedby={`${id}-preview`} className="font-mono" />
          <FieldDescription>Minute, hour, day of month, month, day of week. Local time.</FieldDescription>
        </Field>
      )}
      <NextRuns form={form} id={`${id}-preview`} />
      <Field orientation="horizontal">
        <FieldLabel htmlFor={settingControlId(`${id}-missed`)} className="flex-1">
          Missed while Mochi was quit
        </FieldLabel>
        <SettingsSelect id={`${id}-missed`} value={form.missed} options={MISSED} onChange={(missed) => set({ missed })} />
      </Field>
    </>
  );
}

function NextRuns({ form, id }: { form: ScheduleForm; id: string }) {
  const result = toWhen(form);
  const now = Date.now();
  const next = preview(form, now);
  if ('error' in result || !next) return <FieldError id={id}>{'error' in result ? result.error : 'Not a valid schedule'}</FieldError>;
  return (
    <div id={id} role="status" className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2">
      <span className="type-body text-foreground">{next.text}</span>
      <span className="type-caption text-muted-foreground tabular">
        {next.next.length ? `Next: ${next.next.map((at) => shortRunTime(at, now)).join(', ')}` : 'Never runs'}
      </span>
    </div>
  );
}

function PrFields({ form, set, id }: { form: ScheduleForm; set: (patch: Partial<ScheduleForm>) => void; id: string }) {
  return (
    <>
      <Field orientation="horizontal">
        <FieldLabel htmlFor={settingControlId(`${id}-event`)} className="flex-1">
          When a pull request
        </FieldLabel>
        <SettingsSelect id={`${id}-event`} value={form.event} options={EVENTS} onChange={(event: PrEvent) => set({ event })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-branch`}>Branch</FieldLabel>
          <Input id={`${id}-branch`} value={form.branch} onChange={(e) => set({ branch: e.target.value })} placeholder="Any, * matches" spellCheck={false} autoComplete="off" />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-label`}>Label</FieldLabel>
          <Input id={`${id}-label`} value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="Any" spellCheck={false} autoComplete="off" />
        </Field>
      </div>
      <FieldDescription>Checked with gh every 2 minutes while Mochi runs. Pull requests already open when you save don't count.</FieldDescription>
    </>
  );
}
