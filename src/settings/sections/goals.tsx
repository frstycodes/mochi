import { Slider } from '@/components/ui/slider';
import { SettingsChoice, SettingsGroup, SettingsRow, settingControlId } from '../parts';
import { setPrefs, usePrefs } from '../prefs';

export function GoalsSection() {
  const { driftThreshold, branchFrom, stepSize } = usePrefs();
  const percent = Math.round(driftThreshold * 100);
  return (
    <div className="flex flex-col gap-8">
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

export const BRANCH_FROM = [
  { value: 'current', label: 'Current branch' },
  { value: 'base', label: 'Base branch' },
] as const;

const STEP_SIZES = [
  { value: '1', label: 'S' },
  { value: '2', label: 'M' },
  { value: '3', label: 'L' },
] as const;
