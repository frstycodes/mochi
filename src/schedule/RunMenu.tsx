import { Clock } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SettingsChoice } from '../settings/parts';
import { describeTrigger } from './describe';
import { DEFAULT_FORM, toWhen, type ScheduleForm } from './form';
import { ScheduleFields } from './ScheduleFields';

export type RunMode = 'now' | 'background' | 'trigger';

/** When a new thread runs: now (and you watch it), now in the background, or on a schedule or PR event. */
export interface RunChoice {
  mode: RunMode;
  form: ScheduleForm;
}

export const RUN_NOW: RunChoice = { mode: 'now', form: DEFAULT_FORM };

const MODES = [
  { value: 'now', label: 'Now' },
  { value: 'background', label: 'In background' },
  { value: 'trigger', label: 'On a trigger' },
] satisfies { value: RunMode; label: string }[];

/** The new-thread composer's meta row entry: a clock opening the compact schedule editor. */
export function RunMenu({ value, onChange }: { value: RunChoice; onChange: (value: RunChoice) => void }) {
  const label = runLabel(value);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="min-w-0 text-subtle-foreground hover:text-foreground" aria-label={`Schedule: ${label}`}>
          <Clock />
          <span className="truncate max-sm:hidden">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={16} className="flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-4">
        <SettingsChoice id="new-thread-run" aria-label="Run" value={value.mode} options={MODES} onChange={(mode) => onChange({ ...value, mode })} />
        {value.mode === 'background' && <p className="type-meta text-muted-foreground">Starts now without opening the thread. You'll find it in the sidebar, and in the Queue when it needs you.</p>}
        {value.mode === 'trigger' && <ScheduleFields id="new-thread-schedule" form={value.form} onChange={(form) => onChange({ ...value, form })} />}
      </PopoverContent>
    </Popover>
  );
}

function runLabel(value: RunChoice) {
  if (value.mode === 'now') return 'Now';
  if (value.mode === 'background') return 'In background';
  const result = toWhen(value.form);
  return 'when' in result ? describeTrigger(result.when) : 'Schedule';
}
