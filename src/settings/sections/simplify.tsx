import { CatalogRow } from '../CatalogRow';
import { SettingsGroup } from '../parts';

export function SimplifySection() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="Simplify turns a long agent reply into bullets for you, from its hover bar. Code, commands, file paths and links stay exactly as written. The bullets are yours only: they are never sent to an agent. Changing these makes earlier bullets out of date; Simplify again remakes them. The model is under Agents › Background tasks.">
        <CatalogRow settingKey="simplifyLength" />
        <CatalogRow settingKey="simplifyNeedsFirst" />
        <CatalogRow settingKey="simplifyRules" />
      </SettingsGroup>
      <SettingsGroup footer="Once a thread goes idle, its last reply is simplified if it is longer than this. Show original is always one click away.">
        <CatalogRow settingKey="simplifyAuto" />
        <CatalogRow settingKey="simplifyAutoWords" />
      </SettingsGroup>
    </div>
  );
}
