import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { FsHost } from '@mochi/domain/host/types/fs';
import type { HostMethods } from '../hostMethods.ts';
import { installedEditors, openInEditor } from './editors.ts';
import { readInside, writeInside } from './files.ts';
import { resolveInside, resolveRoot } from './contain.ts';
import { listFiles } from './list.ts';
import { cancelSearch, searchFor } from './search.ts';

const MAX_FOLDERS = 500;

/** Main keeps these: they open Finder and the folder picker. */
export type InMain = 'reveal' | 'pickFolder';

export const fs = {
  list: (_caller, root) => listFiles(root),
  read: (_caller, root, path) => readInside(root, path),
  write: (_caller, root, path, text, options) =>
    writeInside(root, path, text, options),
  search: searchFor,
  cancelSearch: async (_caller, id) => cancelSearch(id),
  editors: () => installedEditors(),
  openIn: async (_caller, editor, root, path, line) => {
    const file = path ? await resolveInside(root, path) : '';
    await openInEditor(editor, await resolveRoot(root), file, line);
  },
  folders: async (_caller, at) => {
    const dir = path.resolve(at.replace(/^~(?=\/|$)/, homedir()));
    if (!(await stat(dir).catch(() => null))?.isDirectory()) return null;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const names = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
    return {
      path: dir,
      names: names.sort((a, b) => a.localeCompare(b)).slice(0, MAX_FOLDERS),
    };
  },
  entries: async (_caller, at) => {
    const dir = path.resolve(at.replace(/^~(?=\/|$)/, homedir()));
    if (!(await stat(dir).catch(() => null))?.isDirectory()) return null;
    const entries = (
      await readdir(dir, { withFileTypes: true }).catch(() => [])
    ).sort((a, b) => a.name.localeCompare(b.name));
    const names = (isDir: boolean) =>
      entries
        .filter((e) => e.isDirectory() === isDir)
        .map((e) => e.name)
        .slice(0, MAX_FOLDERS);
    return { path: dir, dirs: names(true), files: names(false) };
  },
} satisfies HostMethods<Omit<FsHost, InMain>>;
