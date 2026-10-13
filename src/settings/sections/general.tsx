import { CatalogRow } from '../CatalogRow';
import { SettingsGroup } from '../parts';

export function GeneralSection() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="System follows your OS appearance and its Reduce motion setting.">
        <CatalogRow settingKey="theme" />
        <CatalogRow settingKey="reduceMotion" />
      </SettingsGroup>
      <SettingsGroup footer="Open folder in the new thread's project picker starts here.">
        <CatalogRow settingKey="projectsFolder" />
      </SettingsGroup>
      <SettingsGroup footer="Off: every launch opens each space on its default view.">
        <CatalogRow settingKey="restoreLayout" />
      </SettingsGroup>
    </div>
  );
}

