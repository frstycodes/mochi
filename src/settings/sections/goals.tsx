import { CatalogRow } from '../CatalogRow';
import { SettingsGroup } from '../parts';

export function GoalsSection() {
  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup title="Drift" footer="Messages always send. A thread turns the guard off for itself from its goal editor, or after you keep two suggestions there.">
        <CatalogRow settingKey="driftGuard" />
        <CatalogRow settingKey="branchFrom" />
      </SettingsGroup>
      <SettingsGroup title="Writing goals">
        <CatalogRow settingKey="proposedGoals" />
      </SettingsGroup>
      <SettingsGroup title="When a thread goes idle">
        <CatalogRow settingKey="idleChecks" />
      </SettingsGroup>
      <SettingsGroup title="Before a pull request" footer="You can always choose Open anyway on the verdict card.">
        <CatalogRow settingKey="prGaps" />
      </SettingsGroup>
    </div>
  );
}
