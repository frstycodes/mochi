import { app } from 'electron';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataHost } from '../../src/host/types/data.ts';
import { string, type Handlers } from './handlers.ts';

const MAX_CHARS = 64 * 1024 * 1024;
const file = () => join(app.getPath('userData'), 'threads.json');

// Saves are serialized and written to a temp file first, so a quit mid-write leaves the previous file whole.
let writing: Promise<void> = Promise.resolve();

export const data = {
  async load() {
    await writing;
    return readFile(file(), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  },
  async save(_sender, json) {
    const text = string(json, 'json', MAX_CHARS);
    writing = writing.catch(() => {}).then(async () => {
      await writeFile(`${file()}.tmp`, text, { mode: 0o600 });
      await rename(`${file()}.tmp`, file());
    });
    return writing;
  },
} satisfies Handlers<DataHost>;
