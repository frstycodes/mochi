import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SavedFiles } from '../../src/host/types/data.ts';

/**
 * `dir/index.json` plus one `dir/<threadId>.json` per thread, so a save rewrites only the threads that changed and no single
 * file grows with the whole history. `legacy` is the one-document `threads.json` this replaced.
 */
export function threadStore(dir: string, legacy: string) {
  const index = join(dir, 'index.json');
  const threadFile = (id: string) => {
    if (!/^[\w-]+$/.test(id)) throw new TypeError('thread ids must be letters, digits, - or _');
    return join(dir, `${id}.json`);
  };

  return {
    /** null when nothing was saved yet; a `threads.json` from before the split comes back whole as the index. */
    async load(): Promise<SavedFiles | null> {
      const text = await readFile(index, 'utf8').catch(orNull);
      if (text === null) {
        const old = await readFile(legacy, 'utf8').catch(orNull);
        return old === null ? null : { index: old, threads: [] };
      }
      const texts = await Promise.all(threadIds(text).map((id) => readFile(threadFile(id), 'utf8').catch(orNull)));
      return { index: text, threads: texts.filter((t) => t !== null) };
    },

    /** Thread files first and the index last, so a quit mid-save leaves an index whose threads are all on disk. */
    async save(text: string, changed: Record<string, string>) {
      const ids = new Set(threadIds(text));
      await mkdir(dir, { recursive: true });
      for (const [id, json] of Object.entries(changed)) await writeAtomic(threadFile(id), json);
      await writeAtomic(index, text);
      const stale = (await readdir(dir)).filter((n) => n.endsWith('.json') && n !== 'index.json' && !ids.has(n.slice(0, -5)));
      await Promise.all(stale.map((n) => rm(join(dir, n), { force: true })));
      // Kept rather than deleted: the only copy of everything until this first split save landed.
      await rename(legacy, legacy.replace(/\.json$/, '.legacy.json')).catch(orNull);
    },
  };

  async function writeAtomic(path: string, text: string) {
    await writeFile(`${path}.tmp`, text, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
}

function threadIds(index: string): string[] {
  const ids = (JSON.parse(index) as { threadIds?: unknown }).threadIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

function orNull(error: NodeJS.ErrnoException) {
  if (error.code === 'ENOENT') return null;
  throw error;
}
