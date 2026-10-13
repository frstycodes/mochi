import { CatalogRow } from '../CatalogRow';
import { DesktopOnly, SettingsGroup } from '../parts';

export function TerminalSection() {
  return (
    <div className="flex flex-col gap-8">
      <DesktopOnly what="Choosing the shell and restoring terminals need the Mochi desktop app; the web build's terminal plays a scripted demo.">
        <SettingsGroup footer="New terminals start this shell; leave it empty for your login shell ($SHELL). Only zsh gets the failed-command fix prompt. Restoring brings back each thread's terminal tabs and recent output; the shells start fresh.">
          <CatalogRow settingKey="shell" />
          <CatalogRow settingKey="restoreTerminals" />
        </SettingsGroup>
      </DesktopOnly>
      <SettingsGroup footer="Open terminals change right away.">
        <CatalogRow settingKey="terminalFontSize" />
        <CatalogRow settingKey="terminalScrollback" />
      </SettingsGroup>
    </div>
  );
}
