import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Stream } from 'effect';
import { sweepImages } from '../agents/images.ts';
import type { DocTable } from './migrations.ts';
import type { AppendInput, SavedFiles, Store } from './store.ts';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The store's RPCs, and the `data.load`/`data.save` host methods it now serves in place of main. */
export const storeHandlers = (store: Store['Service'], userData: string | undefined) => {
  let hasSwept = false;
  return {
    shell: () => store.shell.pipe(Stream.mapError(messageOf)),
    thread: ({ threadId, afterSequence }: { threadId: string; afterSequence: number }) => store.thread(threadId, afterSequence).pipe(Stream.mapError(messageOf)),
    'events.append': (input: AppendInput) => store.append(input).pipe(Effect.mapError(messageOf)),
    'docs.list': ({ table }: { table: DocTable }) => store.listDocs(table).pipe(Effect.mapError(messageOf)),
    'docs.get': ({ table, key }: { table: DocTable; key: string }) => store.getDoc(table, key).pipe(Effect.map((value) => value ?? null), Effect.mapError(messageOf)),
    'docs.set': ({ table, key, value }: { table: DocTable; key: string; value?: unknown }) => store.setDoc(table, key, value).pipe(Effect.mapError(messageOf)),
    'data.load': () =>
      store.loadThreads.pipe(
        Effect.tap((files) => {
          // Every window loads; the first load of a launch sweeps.
          if (!files || !userData || hasSwept) return Effect.void;
          hasSwept = true;
          return Effect.forkDetach(sweepUnreferenced(userData, files));
        }),
        Effect.mapError(messageOf),
      ),
    'data.save': ([index, changed]: readonly [string, Readonly<Record<string, string>>]) => store.saveThreads(index, changed).pipe(Effect.mapError(messageOf)),
  };
};

// Replays can name an image the thread itself no longer shows (after a rewind), so they count as references too.
const sweepUnreferenced = (userData: string, files: SavedFiles) =>
  Effect.tryPromise(async () => {
    const startedAt = Date.now();
    const replays = join(userData, 'replays');
    const names = (await readdir(replays).catch(() => [] as string[])).filter((n) => n.endsWith('.jsonl'));
    const recordings = await Promise.all(names.map((n) => readFile(join(replays, n), 'utf8').catch(() => '')));
    await sweepImages(join(userData, 'images'), [files.index, ...files.threads, ...recordings], startedAt);
  }).pipe(
    // A failed sweep only leaves unused images on disk until the next launch.
    Effect.catch((error) => Effect.logWarning(`Image sweep failed: ${messageOf(error)}`).pipe(Effect.annotateLogs({ source: 'store' }))),
  );
