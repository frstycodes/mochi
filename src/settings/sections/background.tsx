import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ModelPicker, useUnavailableHarnesses } from '../../ModelControls';
import { host } from '../../host';
import type { AgentSettings, ModelChoice } from '../../host/types/settings';
import { useSpace } from '../../store';
import { UTILITY_TASKS, type UtilityTask } from '../../utility/prompts';
import { SettingsGroup, SettingsRow, settingControlId } from '../parts';

export const UTILITY_TASK_LABELS = {
  title: 'Thread titles',
  outcome: 'Goals',
  commit: 'Commit messages',
  pr: 'Pull requests',
  goal: 'Goal steps',
  handoff: 'Handoff summaries',
} satisfies Record<UtilityTask, string>;

export function BackgroundSection() {
  const [models, setModel] = useUtilityModels();
  const unavailable = useUnavailableHarnesses(useSpace().id);
  if (!models) return null;
  return (
    <SettingsGroup footer="Each task runs on its model through this profile's account, falling back to Haiku 5.5, then GPT-6-Luna, on whichever is signed in; with neither, Mochi keeps its own text. Never an API key unless the harness itself signs in with one. Generated titles never replace one you renamed, and drafts are yours to edit before anything is sent.">
      {UTILITY_TASKS.map((task) => (
        <SettingsRow
          key={task}
          id={`utility-${task}`}
          label={UTILITY_TASK_LABELS[task]}
          control={<ModelPicker id={settingControlId(`utility-${task}`)} value={models[task].model} provider={models[task].provider} unavailable={unavailable} onChange={(m) => setModel(task, { provider: m.harness, model: m.id })} />}
        />
      ))}
    </SettingsGroup>
  );
}

function useUtilityModels() {
  const [models, setModels] = useState<AgentSettings['utilityModels'] | null>(null);
  useEffect(() => {
    let isCurrent = true;
    host.settings.get().then(
      (s) => isCurrent && setModels(s.utilityModels),
      () => {},
    );
    return () => {
      isCurrent = false;
    };
  }, []);
  const save = (task: UtilityTask, choice: ModelChoice) => {
    setModels((prev) => prev && { ...prev, [task]: choice });
    host.settings.set({ utilityModels: { [task]: choice } }).catch((error: Error) => toast.error('Model not saved', { description: error.message }));
  };
  return [models, save] as const;
}
