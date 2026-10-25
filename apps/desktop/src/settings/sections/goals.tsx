import { CatalogRow } from '../CatalogRow';
import { SettingsGroup } from '../parts';
import { usePrefs } from '../prefs';

export function GoalsSection() {
  const { goals } = usePrefs();
  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup
        footer={
          goals
            ? undefined
            : 'Agents get no goal instructions or tools, and threads show no goals, checks or verdicts. Goals you already set are kept for when you turn this back on. A running agent picks this up on its next session.'
        }
      >
        <CatalogRow settingKey="goals" />
      </SettingsGroup>
      {goals && (
        <>
          <SettingsGroup
            title="Drift"
            footer="Messages always send. A thread turns the guard off for itself from its goal editor, or after you keep two suggestions there."
          >
            <CatalogRow settingKey="driftGuard" />
            <CatalogRow settingKey="branchFrom" />
          </SettingsGroup>
          <SettingsGroup title="Writing goals">
            <CatalogRow settingKey="proposedGoals" />
          </SettingsGroup>
          <SettingsGroup title="When a thread goes idle">
            <CatalogRow settingKey="idleChecks" />
          </SettingsGroup>
        </>
      )}
    </div>
  );
}
