import { app, BrowserWindow, dialog, shell } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ThemesHost } from '@mochi/domain/host/types/themes';
import {
  customDirOf,
  saveCustomText,
  type InMain,
} from '@mochi/core/themes/host';
import { checkCustomFile } from '@mochi/domain/themes/custom';
import { LIMITS, loadTheme } from '@mochi/domain/themes/vsix';
import type { Handlers } from './handlers.ts';

// The rest of `host.themes` is Core's (packages/core/src/themes/host.ts).
export const themes = {
  async importFile(sender) {
    const window = BrowserWindow.fromWebContents(sender);
    const options = {
      properties: ['openFile'],
      filters: [{ name: 'VS Code color theme', extensions: ['json', 'jsonc'] }],
    } satisfies Electron.OpenDialogOptions;
    const { canceled, filePaths } = await (window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options));
    if (canceled || !filePaths[0]) return null;
    const dir = dirname(filePaths[0]);
    // Includes resolve next to the picked file and may not leave its folder (`resolvePath`).
    const theme = await loadTheme(basename(filePaths[0]), async (path) => {
      const file = join(dir, path);
      if ((await stat(file)).size > LIMITS.fileBytes)
        throw new Error(`${path} is larger than ${LIMITS.fileBytes} bytes`);
      return readFile(file, 'utf8');
    });
    const text = JSON.stringify(
      {
        ...theme,
        name: theme.name ?? basename(filePaths[0]).replace(/\.jsonc?$/i, ''),
      },
      null,
      2,
    );
    return saveCustomText(app.getPath('userData'), text);
  },
  async openCustom(_sender, file) {
    const error = await shell.openPath(
      join(customDirOf(app.getPath('userData')), checkCustomFile(file)),
    );
    if (error) throw new Error(error);
  },
} satisfies Handlers<Pick<ThemesHost, InMain>>;
