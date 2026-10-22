import { BrowserWindow, dialog, shell } from 'electron';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { FsHost } from '../../src/host/types/fs.ts';
import { installedEditors, openInEditor } from '../fs/editors.ts';
import { readInside, unwatchRoot, watchRoot, writeInside } from '../fs/files.ts';
import { resolveInside, resolveRoot } from '../fs/contain.ts';
import { listFiles } from '../fs/list.ts';
import { cancelSearch, searchFor } from '../fs/search.ts';
import type { Handlers } from './handlers.ts';

const MAX_FOLDERS = 500;

export const fs = {
  list: (_sender, root) => listFiles(root),
  read: (_sender, root, path) => readInside(root, path),
  write: (_sender, root, path, text, options) => writeInside(root, path, text, options),
  search: (sender, root, id, pattern, options) => searchFor(sender, root, id, pattern, options),
  cancelSearch: async (_sender, id) => cancelSearch(id),
  watch: (sender, root) => watchRoot(sender, root),
  unwatch: async (sender, root) => unwatchRoot(sender, root),
  editors: () => installedEditors(),
  openIn: async (_sender, editor, root, path, line) => {
    const file = path ? await resolveInside(root, path) : '';
    await openInEditor(editor, await resolveRoot(root), file, line);
  },
  reveal: async (_sender, root, path) => {
    shell.showItemInFolder(path ? await resolveInside(root, path) : await resolveRoot(root));
  },
  pickFolder: async (sender, defaultPath) => {
    const start = defaultPath?.replace(/^~(?=\/|$)/, homedir());
    const options = { defaultPath: start ?? homedir(), properties: ['openDirectory', 'createDirectory'] } satisfies Electron.OpenDialogOptions;
    const window = BrowserWindow.fromWebContents(sender);
    const { canceled, filePaths } = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options));
    return canceled ? null : (filePaths[0] ?? null);
  },
  folders: async (_sender, at) => {
    const dir = path.resolve(at.replace(/^~(?=\/|$)/, homedir()));
    if (!(await stat(dir).catch(() => null))?.isDirectory()) return null;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const names = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
    return { path: dir, names: names.sort((a, b) => a.localeCompare(b)).slice(0, MAX_FOLDERS) };
  },
  entries: async (_sender, at) => {
    const dir = path.resolve(at.replace(/^~(?=\/|$)/, homedir()));
    if (!(await stat(dir).catch(() => null))?.isDirectory()) return null;
    const entries = (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name));
    const names = (isDir: boolean) =>
      entries
        .filter((e) => e.isDirectory() === isDir)
        .map((e) => e.name)
        .slice(0, MAX_FOLDERS);
    return { path: dir, dirs: names(true), files: names(false) };
  },
} satisfies Handlers<FsHost>;
