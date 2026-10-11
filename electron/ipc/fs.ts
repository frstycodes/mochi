import { EDITORS, type Editor, type FsHost } from '../../src/host/types/fs.ts';
import { installedEditors, openInEditor } from '../fs/editors.ts';
import { readInside, unwatchRoot, watchRoot, writeInside } from '../fs/files.ts';
import { resolveInside, resolveRoot } from '../fs/contain.ts';
import { listFiles } from '../fs/list.ts';
import { record, string, type Handlers } from './handlers.ts';

const MAX_WRITE_CHARS = 5 * 1024 * 1024;

export const fs = {
  list: (_sender, root) => listFiles(string(root, 'root')),
  read: (_sender, root, path) => readInside(string(root, 'root'), string(path, 'path')),
  write: (_sender, root, path, text, options) => {
    const { baseMtimeMs, force } = record(options, 'options');
    if (typeof baseMtimeMs !== 'number' || !Number.isFinite(baseMtimeMs)) throw new TypeError('options.baseMtimeMs must be a number');
    if (force !== undefined && typeof force !== 'boolean') throw new TypeError('options.force must be a boolean');
    return writeInside(string(root, 'root'), string(path, 'path'), string(text, 'text', MAX_WRITE_CHARS), { baseMtimeMs, force });
  },
  watch: (sender, root) => watchRoot(sender, string(root, 'root')),
  unwatch: async (sender, root) => unwatchRoot(sender, string(root, 'root')),
  editors: () => installedEditors(),
  openIn: async (_sender, editor, root, path, line) => {
    if (!EDITORS.includes(editor as Editor)) throw new TypeError(`editor must be one of ${EDITORS.join(', ')}`);
    if (line !== undefined && !(Number.isInteger(line) && (line as number) > 0)) throw new TypeError('line must be a positive integer');
    const file = await resolveInside(string(root, 'root'), string(path, 'path'));
    await openInEditor(editor as Editor, await resolveRoot(string(root, 'root')), file, line as number | undefined);
  },
} satisfies Handlers<FsHost>;
