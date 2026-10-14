import { CatalogRow } from '../CatalogRow';
import { SettingsGroup } from '../parts';

export function GoalsSection() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="Once a thread has a concrete goal, a message that clearly starts separate work gets a suggestion to move it to a new thread. Messages always send. A thread turns it off for itself from its goal editor, or after you keep two suggestions there.">
        <CatalogRow settingKey="driftGuard" />
      </SettingsGroup>
      <SettingsGroup>
        <CatalogRow settingKey="branchFrom" />
      </SettingsGroup>
    </div>
  );
}
