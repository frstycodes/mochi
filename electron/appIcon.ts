import { app, BrowserWindow, nativeImage, type NativeImage } from 'electron';
import path from 'node:path';
import { APP_ICONS, type AppIcon } from '../src/settings/settingOptions.ts';
import { agentSettings, onAgentSettingsChange } from './agents/config.ts';
import { setTrayImage } from './tray.ts';

/**
 * Settings › Appearance › App icon: the Dock icon on macOS, the window and tray icons elsewhere, from launch and on every
 * change. GAP: Finder, Launchpad and the Dock while Mochi is closed still show the bundle's icon (`build/icon.icns`);
 * Electron has no API for a custom bundle icon.
 */
export function startAppIcon() {
  let current = agentSettings().appIcon;
  apply(current);
  onAgentSettingsChange(({ appIcon }) => {
    if (appIcon === current) return;
    current = appIcon;
    apply(appIcon);
  });
  app.on('browser-window-created', (_event, win) => process.platform !== 'darwin' && win.setIcon(appIconImage(current)));
}

export function appIconImage(icon: AppIcon = agentSettings().appIcon): NativeImage {
  // A saved icon that has since been removed falls back to the default.
  const name = APP_ICONS.some((i) => i.value === icon) ? icon : 'graphite';
  return nativeImage.createFromPath(app.isPackaged ? path.join(process.resourcesPath, 'icons', `${name}.png`) : path.join(import.meta.dirname, '../build/icons', `${name}.png`));
}

function apply(icon: AppIcon) {
  const image = appIconImage(icon);
  if (process.platform === 'darwin') return app.dock?.setIcon(image);
  for (const win of BrowserWindow.getAllWindows()) win.setIcon(image);
  setTrayImage(image);
}
