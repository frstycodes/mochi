import { app, BrowserWindow, dialog } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataHost } from '../../src/host/types/data.ts';
import type { InMain } from '@mochi/core/data/host';
import {
  embedReplay,
  isSelfContained,
  replayFileName,
} from '@mochi/domain/replay/page';
import { indexHtml } from '../window.ts';
import type { Handlers } from './handlers.ts';

// The rest of `host.data` is Core's (packages/core/src/data/host.ts).
export const data = {
  async exportReplay(sender, payload, name) {
    const parsed = JSON.parse(payload);
    if (parsed?.version !== 1 || !parsed.recording?.base)
      throw new TypeError('payload must be a replay export');
    if (process.env.VITE_DEV_SERVER_URL)
      throw new Error(
        'Exporting needs the built app: the dev server page loads its scripts from the network',
      );
    const html = await readFile(indexHtml, 'utf8');
    if (!isSelfContained(html))
      throw new Error(
        'This build loads scripts from separate files, so its page can’t be shared on its own',
      );
    const window = BrowserWindow.fromWebContents(sender);
    const options = {
      defaultPath: join(app.getPath('downloads'), replayFileName(name)),
      filters: [{ name: 'Web page', extensions: ['html'] }],
    } satisfies Electron.SaveDialogOptions;
    const { canceled, filePath } = await (window
      ? dialog.showSaveDialog(window, options)
      : dialog.showSaveDialog(options));
    if (canceled || !filePath) return null;
    await writeFile(filePath, embedReplay(html, parsed, name));
    return filePath;
  },
} satisfies Handlers<Pick<DataHost, InMain>>;
