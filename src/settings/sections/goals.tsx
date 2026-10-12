import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { SettingsChoice, SettingsGroup, SettingsRow, settingControlId } from '../parts';
import { setPrefs, usePrefs } from '../prefs';
import { BRANCH_FROM } from '../settingOptions';

export function GoalsSection() {
  const { driftGuard, driftThreshold, branchFrom, stepSize } = usePrefs();
  const percent = Math.round(driftThreshold * 100);
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="Checks each message against the thread's goal and asks before an off-goal one goes out. Off sends every message straight through. A thread can still turn it off for itself from its goal editor.">
        <SettingsRow id="driftGuard" label="Drift guard" control={<Switch id={settingControlId('driftGuard')} checked={driftGuard} onCheckedChange={(on) => setPrefs({ driftGuard: on })} />} />
      </SettingsGroup>
      <SettingsGroup footer="A prompt that shares less than this with the goal and its open steps counts as off-goal. Higher catches more. A thread's own setting, from its goal editor, wins.">
        <SettingsRow
          id="driftThreshold"
          label="Drift sensitivity"
          control={
            <div className="flex w-full items-center gap-3 sm:w-60">
              <Slider
                id={settingControlId('driftThreshold')}
                aria-label="Drift sensitivity"
                min={5}
                max={40}
                step={1}
                disabled={!driftGuard}
                value={[percent]}
                onValueChange={([v]) => setPrefs({ driftThreshold: v / 100 })}
                className="flex-1"
              />
              <span className="w-9 text-right type-meta text-muted-foreground tabular">{percent}%</span>
            </div>
          }
        />
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


const STEP_SIZES = [
  { value: '1', label: 'S' },
  { value: '2', label: 'M' },
  { value: '3', label: 'L' },
] as const;
