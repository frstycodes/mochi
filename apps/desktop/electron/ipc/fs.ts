import { BrowserWindow, dialog, shell } from 'electron';
import { homedir } from 'node:os';
import type { FsHost } from '@mochi/domain/host/types/fs';
import { resolveInside, resolveRoot } from '@mochi/core/fs/contain';
import type { InMain } from '@mochi/core/fs/host';
import type { Handlers } from './handlers.ts';

// The rest of `host.fs` is Core's (packages/core/src/fs/host.ts).
export const fs = {
  reveal: async (_sender, root, path) => {
    shell.showItemInFolder(
      path ? await resolveInside(root, path) : await resolveRoot(root),
    );
  },
  pickFolder: async (sender, defaultPath) => {
    const start = defaultPath?.replace(/^~(?=\/|$)/, homedir());
    const options = {
      defaultPath: start ?? homedir(),
      properties: ['openDirectory', 'createDirectory'],
    } satisfies Electron.OpenDialogOptions;
    const window = BrowserWindow.fromWebContents(sender);
    const { canceled, filePaths } = await (window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options));
    return canceled ? null : (filePaths[0] ?? null);
  },
} satisfies Handlers<Pick<FsHost, InMain>>;
