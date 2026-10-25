import { CatalogRow } from '../CatalogRow';
import { DesktopOnly, SettingsGroup } from '../parts';

export function TerminalSection() {
  return (
    <div className="flex flex-col gap-10">
      <DesktopOnly what="Choosing the shell and restoring terminals need the Mochi desktop app; the web build's terminal plays a scripted demo.">
        <SettingsGroup
          title="Shell"
          footer="Only zsh gets the failed-command fix prompt."
        >
          <CatalogRow settingKey="shell" />
          <CatalogRow settingKey="restoreTerminals" />
        </SettingsGroup>
      </DesktopOnly>
      <SettingsGroup title="Display" footer="Open terminals change right away.">
        <CatalogRow settingKey="terminalFontSize" />
        <CatalogRow settingKey="terminalScrollback" />
      </SettingsGroup>
    </div>
  );
}
