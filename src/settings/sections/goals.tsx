import { Switch } from '@/components/ui/switch';
import { SettingsChoice, SettingsGroup, SettingsRow, settingControlId } from '../parts';
import { setPrefs, usePrefs } from '../prefs';

export function GoalsSection() {
  const { driftGuard, branchFrom, stepSize } = usePrefs();
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="Once a thread has a concrete goal, a message that clearly starts separate work gets a suggestion to move it to a new thread. Messages always send. A thread turns it off for itself from its goal editor, or after you keep two suggestions there.">
        <SettingsRow id="driftGuard" label="Drift guard" control={<Switch id={settingControlId('driftGuard')} checked={driftGuard} onCheckedChange={(on) => setPrefs({ driftGuard: on })} />} />
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow
          id="branchFrom"
          label="Off-goal work branches from"
          control={<SettingsChoice id="branchFrom" value={branchFrom} options={BRANCH_FROM} onChange={(v) => setPrefs({ branchFrom: v })} />}
        />
      </SettingsGroup>
      <SettingsGroup footer="Size counts toward the goal's progress and ETA: S is 1 point, M 2, L 3. Applies to steps you add and to plan items the agent leaves unsized.">
        <SettingsRow
          id="stepSize"
          label="New step size"
          control={<SettingsChoice id="stepSize" value={String(stepSize) as '1' | '2' | '3'} options={STEP_SIZES} onChange={(v) => setPrefs({ stepSize: Number(v) as 1 | 2 | 3 })} />}
        />
      </SettingsGroup>
    </div>
  );
}

export const BRANCH_FROM = [
  { value: 'current', label: 'Current branch' },
  { value: 'base', label: 'Base branch' },
] as const;

const STEP_SIZES = [
  { value: '1', label: 'S' },
  { value: '2', label: 'M' },
  { value: '3', label: 'L' },
] as const;
