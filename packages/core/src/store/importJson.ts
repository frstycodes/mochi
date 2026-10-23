import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { DocTable } from './migrations.ts';
import { Store } from './store.ts';

/** A file the import could not read. It was renamed to `kept` and left for you; nothing was written over it. */
export interface CorruptFile {
  readonly file: string;
  readonly kept: string;
  readonly error: string;
}

// The JSON files main wrote before the store, each with the documents it becomes. Read once each, recorded in `imports`.
const documents: ReadonlyArray<{ file: string; table: DocTable; keys: (parsed: unknown) => ReadonlyArray<[string, unknown]> }> = [
  { file: 'agent-settings.json', table: 'settings', keys: (parsed) => [['agent', parsed]] },
  { file: 'projects.json', table: 'projects', keys: (parsed) => [['registry', parsed]] },
  { file: 'schedules.json', table: 'schedule', keys: (parsed) => [['schedules', parsed]] },
  { file: 'autofix.json', table: 'autofix', keys: (parsed) => [['autofix', parsed]] },
  { file: 'library.json', table: 'library', keys: (parsed) => [['index', parsed]] },
  { file: 'limits.json', table: 'limits', keys: (parsed) => Object.entries(parsed as Record<string, unknown>) },
  { file: 'window-state.json', table: 'window_bounds', keys: (parsed) => [['main', parsed]] },
];

/**
 * Takes main's JSON files into the store on the first launch with it: `threads/` (or the older `threads.json`) and every
 * file in `documents`. A missing file imports as nothing. A file that won't parse is renamed `.corrupt-<timestamp>` and
 * returned, so it is reported and never overwritten; the defaults apply in its place. The originals stay where they were.
 */
export const importJson = (userData: string) =>
  Effect.gen(function* () {
    const store = yield* Store;
    const sql = yield* SqlClient.SqlClient;
    const done = new Set((yield* sql<{ source: string }>`SELECT source FROM imports`).map((row) => row.source));
    const corrupt: CorruptFile[] = [];
    const record = (source: string, status: 'imported' | 'missing' | 'corrupt', detail?: string) =>
      sql`INSERT INTO imports (source, status, detail, at) VALUES (${source}, ${status}, ${detail ?? null}, ${new Date().toISOString()})`;

    /** The file's JSON text, `null` when missing, `undefined` when unreadable (already moved aside). */
    const read = (file: string) =>
      Effect.promise(async () => {
        const path = join(userData, file);
        const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (text === null) return null;
        try {
          JSON.parse(text);
          return text;
        } catch (error) {
          const kept = `${path}.corrupt-${Date.now()}`;
          await rename(path, kept);
          corrupt.push({ file: path, kept, error: (error as Error).message });
          return undefined;
        }
      });

    for (const { file, table, keys } of documents) {
      if (done.has(file)) continue;
      const text = yield* read(file);
      if (typeof text === 'string') for (const [key, value] of keys(JSON.parse(text))) yield* store.setDoc(table, key, value);
      yield* record(file, text === null ? 'missing' : text === undefined ? 'corrupt' : 'imported');
    }

    if (!done.has('threads')) {
      const index = yield* read('threads/index.json');
      const files = typeof index === 'string' ? yield* threadFiles(index, read) : {};
      // Before the split everything was one `threads.json`; the renderer reads it whole as the index (`joinSaved`).
      const legacy = index === null ? yield* read('threads.json') : null;
      const text = typeof index === 'string' ? index : typeof legacy === 'string' ? legacy : null;
      if (text !== null) yield* store.saveThreads(text, files);
      yield* record('threads', text === null ? (index === undefined || legacy === undefined ? 'corrupt' : 'missing') : 'imported');
    }

    for (const file of corrupt) yield* Effect.logWarning(`Kept unreadable ${file.file} as ${file.kept}: ${file.error}`).pipe(Effect.annotateLogs({ source: 'store' }));
    return corrupt;
  });

/** Each thread file the index lists; one that won't parse is moved aside and that thread is left out. */
const threadFiles = (index: string, read: (file: string) => Effect.Effect<string | null | undefined>) =>
  Effect.gen(function* () {
    const ids = (JSON.parse(index) as { threadIds?: unknown }).threadIds;
    const files: Record<string, string> = {};
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) continue;
      const text = yield* read(`threads/${id}.json`);
      if (typeof text === 'string') files[id] = text;
    }
    return files;
  });
