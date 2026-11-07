import { app, BrowserWindow, dialog, shell } from 'electron';
import { homedir } from 'node:os';
import type { FsHost } from '@mochi/domain/host/types/fs';
import { resolveInside, resolveRoot } from '@mochi/core/fs/contain';
import type { InMain } from '@mochi/core/fs/host';
import type { Handlers } from './handlers.ts';

const icons = new Map<string, Promise<string | null>>();

// The rest of `host.fs` is Core's (packages/core/src/fs/host.ts).
export const fs = {
  reveal: async (_sender, root, path) => {
    shell.showItemInFolder(
      path ? await resolveInside(root, path) : await resolveRoot(root),
    );
  },
  open: async (_sender, path) => {
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  },
  fileIcon: (_sender, name) => {
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
    let icon = icons.get(ext);
    // macOS answers by extension even for a path that doesn't exist (checked on Electron's getFileIcon); Windows and Linux not checked.
    if (!icon) {
      icon = app
        .getFileIcon(`/mochi-icon.${ext || 'file'}`, { size: 'normal' })
        .then((image) => (image.isEmpty() ? null : image.toDataURL()))
        .catch(() => null);
      icons.set(ext, icon);
    }
    return icon;
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
