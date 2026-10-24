import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Stream } from 'effect';
import { sweepImages } from '../agents/images.ts';
import type { DocTable } from './migrations.ts';
import type { Projection } from './projection.ts';
import type { AppendInput, SavedFiles, Store } from './store.ts';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The store's RPCs. */
export const storeHandlers = (store: Store['Service'], projection: Projection['Service']) => ({
    shell: () => store.shell.pipe(Stream.mapError(messageOf)),
    thread: ({ threadId, afterSequence }: { threadId: string; afterSequence: number }) => store.thread(threadId, afterSequence).pipe(Stream.mapError(messageOf)),
    'events.append': (input: AppendInput) => store.append(input).pipe(Effect.mapError(messageOf)),
    'docs.list': ({ table }: { table: DocTable }) => store.listDocs(table).pipe(Effect.mapError(messageOf)),
    'docs.get': ({ table, key }: { table: DocTable; key: string }) => store.getDoc(table, key).pipe(Effect.map((value) => value ?? null), Effect.mapError(messageOf)),
    'docs.set': ({ table, key, value }: { table: DocTable; key: string; value?: unknown }) => store.setDoc(table, key, value).pipe(Effect.mapError(messageOf)),
    replica: ({ afterSequence }: { afterSequence: number }) => projection.replica(afterSequence).pipe(Stream.mapError(messageOf)),
});

/** Once a launch, as the projection loads. Replays can name an image the thread itself no longer shows (after a rewind), so they count as references too. */
export const sweepUnreferenced = (userData: string, files: SavedFiles) =>
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
