import { CatalogRow } from '../CatalogRow';
import { SettingsGroup } from '../parts';
import { IDLE_ALERTS } from '../settingOptions';

export function GoalsSection() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="Once a thread has a concrete goal, a message that clearly starts separate work gets a suggestion to move it to a new thread. Messages always send. A thread turns it off for itself from its goal editor, or after you keep two suggestions there.">
        <CatalogRow settingKey="driftGuard" />
      </SettingsGroup>
      <SettingsGroup>
        <CatalogRow settingKey="branchFrom" />
      </SettingsGroup>
      <SettingsGroup title="Writing goals" footer="The agent proposes the goal after its first look at the code. Apply, with undo sets it at once and keeps an Undo on the card.">
        <CatalogRow settingKey="proposedGoals" />
      </SettingsGroup>
      <SettingsGroup title="When a thread goes idle" footer="Mochi says why the agent stopped from what it checks itself, never from the agent's report. The turn audit reads the last reply for questions asked in prose and things the agent says it didn't verify.">
        <CatalogRow settingKey="idleChecks" />
        <CatalogRow settingKey="utility.audit" />
      </SettingsGroup>
      <SettingsGroup title="Before a pull request" footer="Critical: failing checks, failing CI, merge conflicts. You can always choose Open anyway on the verdict card.">
        <CatalogRow settingKey="prGaps" />
      </SettingsGroup>
      <SettingsGroup title="Notify me when a thread goes idle with" footer="Only for threads you aren't looking at.">
        {IDLE_ALERTS.map(({ value }) => (
          <CatalogRow key={value} settingKey={`idleAlert.${value}`} />
        ))}
      </SettingsGroup>
    </div>
  );
}
