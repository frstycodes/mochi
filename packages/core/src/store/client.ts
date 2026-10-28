import { Effect } from 'effect';
import { asJsonValue } from '@mochi/domain';
import type { CoreClient } from '../client.ts';
import type { DocTable } from './migrations.ts';
import type { AppendInput } from './store.ts';

// Main's side of Core's store: the document tables that replaced the JSON files main wrote, and the event log. No
// `electron` import: modules using it run under plain node in tests, where documents stay in this process.

export type Docs = {
  list: (
    table: DocTable,
  ) => Promise<ReadonlyArray<{ key: string; value: unknown }>>;
  set: (table: DocTable, key: string, value: unknown) => Promise<void>;
  append: (input: AppendInput) => Promise<unknown>;
};

let backend: Docs | undefined;
const preloaded = new Map<DocTable, Map<string, unknown>>();
const writes = new Map<DocTable, Promise<void>>();
let pending = 0;

/** Main points this at its Core client (`startCore`). Calls retry across a Core restart (`retryIdempotent`). */
export function useDocsClient(client: Promise<CoreClient>) {
  useDocs({
    list: async (table) =>
      Effect.runPromise((await client)['docs.list']({ table })),
    set: async (table, key, value) =>
      Effect.runPromise(
        (await client)['docs.set']({ table, key, value: asJsonValue(value) }),
      ),
    append: async (input) =>
      Effect.runPromise(
        (await client)['events.append']({
          ...input,
          payload: asJsonValue(input.payload),
        }),
      ),
  });
}

/** Core points this at its own store, for the `host.*` modules it serves (`hosted.ts`). */
export function useDocs(docs: Docs) {
  backend = docs;
}

// ponytail: tests and the web build's absence of Core get a per-process map; same calls, no second store.
const memory = new Map<string, unknown>();
const local: Docs = {
  list: async (table) =>
    [...memory]
      .filter(([id]) => id.startsWith(`${table}/`))
      .map(([id, value]) => ({ key: id.slice(table.length + 1), value })),
  set: async (table, key, value) =>
    void (value === undefined
      ? memory.delete(`${table}/${key}`)
      : memory.set(`${table}/${key}`, value)),
  append: async () => {},
};
const docs = () => backend ?? local;

/** Every document of `table`, by key. */
export async function readDocs<T>(table: DocTable): Promise<Map<string, T>> {
  await writes.get(table);
  const cached = preloaded.get(table);
  if (cached) return new Map(cached) as Map<string, T>;
  return new Map(
    (await docs().list(table)).map(({ key, value }) => [key, value as T]),
  );
}

export const readDoc = async <T>(table: DocTable, key: string) =>
  (await readDocs<T>(table)).get(key);

/** Reads `tables` once so `cachedDoc` can answer synchronously; main awaits it before anything reads them. */
export async function preloadDocs(tables: ReadonlyArray<DocTable>) {
  await Promise.all(
    tables.map(async (table) => preloaded.set(table, await readDocs(table))),
  );
}

/** For callers that can't wait: only for a table `preloadDocs` read. */
export function cachedDoc<T>(table: DocTable, key: string): T | undefined {
  const cached = preloaded.get(table);
  if (!cached) throw new Error(`${table} was not preloaded from Core`);
  return cached.get(key) as T | undefined;
}

/** Another process wrote the document: keeps the preloaded copy current, for a table `preloadDocs` read. */
export function cacheDoc(table: DocTable, key: string, value: unknown) {
  const cached = preloaded.get(table);
  if (!cached) return;
  if (value === undefined) cached.delete(key);
  else cached.set(key, value);
}

/** Writes one at a time per table, each the whole document; `undefined` deletes it. A failure is logged, and rejects. */
export function writeDoc(
  table: DocTable,
  key: string,
  value: unknown,
): Promise<void> {
  const cached = preloaded.get(table);
  if (cached)
    void (value === undefined ? cached.delete(key) : cached.set(key, value));
  pending++;
  const next = (writes.get(table) ?? Promise.resolve())
    .then(() => docs().set(table, key, value))
    .finally(() => pending--);
  writes.set(
    table,
    next.catch((error: unknown) =>
      console.error(`Saving ${table}/${key} failed`, error),
    ),
  );
  return next;
}

/** Settles once every write made so far has landed or failed; main waits on it before quitting. */
export const flushDocs = () => Promise.all(writes.values()).then(() => {});

export const hasPendingDocs = () => pending > 0;

let appending: Promise<unknown> = Promise.resolve();

/**
 * Logs an event in Core, in call order: Core serves requests concurrently, so each waits for the one before. With
 * `eventId` set, a resend after a dropped socket is logged once.
 */
export function logEvent(input: AppendInput) {
  appending = appending
    .then(() => docs().append(input))
    .catch((error: unknown) =>
      console.error(`Logging ${input.type} failed`, error),
    );
}
