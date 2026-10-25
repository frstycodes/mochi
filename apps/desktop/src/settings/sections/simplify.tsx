import { CatalogRow } from '../CatalogRow';
import { SettingsGroup } from '../parts';

export function SimplifySection() {
  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup
        title="Style"
        footer="Simplify rewrites a long reply in plainer words for you only; it is never sent to an agent. Code, commands, paths and links stay exactly as written. Its model is under Models › Background tasks."
      >
        <CatalogRow settingKey="simplifyLength" />
        <CatalogRow settingKey="simplifyNeedsFirst" />
        <CatalogRow settingKey="simplifyRules" />
      </SettingsGroup>
      <SettingsGroup title="Automatic">
        <CatalogRow settingKey="simplifyAuto" />
        <CatalogRow settingKey="simplifyAutoWords" />
      </SettingsGroup>
    </div>
  );
}
