import { BrowserWindow, dialog, shell } from 'electron';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { EDITORS, type Editor, type FsHost } from '../../src/host/types/fs.ts';
import { installedEditors, openInEditor } from '../fs/editors.ts';
import { readInside, unwatchRoot, watchRoot, writeInside } from '../fs/files.ts';
import { resolveInside, resolveRoot } from '../fs/contain.ts';
import { listFiles } from '../fs/list.ts';
import { cancelSearch, searchFor } from '../fs/search.ts';
import { record, string, type Handlers } from './handlers.ts';
import type { SearchOptions } from '../../src/host/types/fs.ts';

const MAX_WRITE_CHARS = 5 * 1024 * 1024;
const MAX_FOLDERS = 500;

export const fs = {
  list: (_sender, root) => listFiles(string(root, 'root')),
  read: (_sender, root, path) => readInside(string(root, 'root'), string(path, 'path')),
  write: (_sender, root, path, text, options) => {
    const { baseMtimeMs, force } = record(options, 'options');
    if (typeof baseMtimeMs !== 'number' || !Number.isFinite(baseMtimeMs)) throw new TypeError('options.baseMtimeMs must be a number');
    if (force !== undefined && typeof force !== 'boolean') throw new TypeError('options.force must be a boolean');
    return writeInside(string(root, 'root'), string(path, 'path'), string(text, 'text', MAX_WRITE_CHARS), { baseMtimeMs, force });
  },
  search: (sender, root, id, pattern, options) => {
    const o = record(options, 'options');
    for (const key of ['isCaseSensitive', 'isRegex', 'isWholeWord']) if (typeof o[key] !== 'boolean') throw new TypeError(`options.${key} must be a boolean`);
    return searchFor(sender, string(root, 'root'), string(id, 'id', 64), string(pattern, 'pattern', 1024), o as unknown as SearchOptions);
  },
  cancelSearch: async (_sender, id) => cancelSearch(string(id, 'id', 64)),
  watch: (sender, root) => watchRoot(sender, string(root, 'root')),
  unwatch: async (sender, root) => unwatchRoot(sender, string(root, 'root')),
  editors: () => installedEditors(),
  openIn: async (_sender, editor, root, path, line) => {
    if (!EDITORS.includes(editor as Editor)) throw new TypeError(`editor must be one of ${EDITORS.join(', ')}`);
    if (line !== undefined && !(Number.isInteger(line) && (line as number) > 0)) throw new TypeError('line must be a positive integer');
    const rel = string(path, 'path');
    const file = rel ? await resolveInside(string(root, 'root'), rel) : '';
    await openInEditor(editor as Editor, await resolveRoot(string(root, 'root')), file, line as number | undefined);
  },
  reveal: async (_sender, root, path) => {
    const rel = string(path, 'path');
    shell.showItemInFolder(rel ? await resolveInside(string(root, 'root'), rel) : await resolveRoot(string(root, 'root')));
  },
  pickFolder: async (sender, defaultPath) => {
    const start = defaultPath === undefined ? undefined : string(defaultPath, 'defaultPath').replace(/^~(?=\/|$)/, homedir());
    const options = { defaultPath: start ?? homedir(), properties: ['openDirectory', 'createDirectory'] } satisfies Electron.OpenDialogOptions;
    const window = BrowserWindow.fromWebContents(sender);
    const { canceled, filePaths } = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options));
    return canceled ? null : (filePaths[0] ?? null);
  },
  folders: async (_sender, at) => {
    const dir = path.resolve(string(at, 'path').replace(/^~(?=\/|$)/, homedir()));
    if (!(await stat(dir).catch(() => null))?.isDirectory()) return null;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const names = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
    return { path: dir, names: names.sort((a, b) => a.localeCompare(b)).slice(0, MAX_FOLDERS) };
  },
  entries: async (_sender, at) => {
    const dir = path.resolve(string(at, 'path').replace(/^~(?=\/|$)/, homedir()));
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
