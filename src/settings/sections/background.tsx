import { UTILITY_TASKS } from '../../utility/prompts';
import { CatalogRow } from '../CatalogRow';
import { SettingsGroup } from '../parts';

export function BackgroundSection() {
  return (
    <SettingsGroup footer="Each task runs on its model through this profile's account, falling back to Haiku 5.5, then GPT-6-Luna, on whichever is signed in; with neither, Mochi keeps its own text. Never an API key unless the harness itself signs in with one. Generated titles never replace one you renamed, and drafts are yours to edit before anything is sent.">
      {UTILITY_TASKS.map((task) => (
        <CatalogRow key={task} settingKey={`utility.${task}`} />
      ))}
    </SettingsGroup>
  );
}
