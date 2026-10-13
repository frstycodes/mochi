import { CatalogRow } from '../CatalogRow';
import { Button } from '@/components/ui/button';
import { useColorTheme } from '../../themes/store';
import { openSettings } from '../open';
import { SettingsGroup, SettingsRow } from '../parts';

export function GeneralSection() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="System follows your OS appearance and its Reduce motion setting.">
        <CatalogRow settingKey="theme" />
        <ColorThemesRow />
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


/** Which color theme each appearance uses; the browser and the custom themes live in Settings › Themes. */
function ColorThemesRow() {
  const { light, dark } = useColorTheme();
  return (
    <SettingsRow
      id="colorThemes"
      label="Color themes"
      description={`Light: ${light?.label ?? 'Mochi'} · Dark: ${dark?.label ?? 'Mochi'}`}
      control={
        <Button variant="outline" size="sm" onClick={() => openSettings('themes')}>
          Browse themes
        </Button>
      }
    />
  );
}
