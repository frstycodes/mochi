import { randomUUID } from 'node:crypto';
import { Context, Effect, Layer, PubSub, Stream } from 'effect';
import { SqlClient } from 'effect/sql';
import { MAX_REPLAY_BYTES, MAX_REPLAY_EVENTS, summarizeProjects, summarizeThread, type LoggedEvent, type ShellItem, type ThreadItem } from '@mochi/domain';
import { docTables, migrate, type DocTable } from './migrations.ts';
import { backupSchedule, restoreLayer } from './backup.ts';
import * as NodeSqliteClient from './nodeSqliteClient.ts';

export interface AppendInput {
  readonly type: string;
  readonly threadId?: string | null;
  readonly payload?: unknown;
  /** Set for a command: a second append with the same id is not applied again and returns the first one's sequence. */
  readonly commandId?: string;
  /** Unique; an append whose id is already logged returns that event's sequence instead, so a resend is harmless. */
  readonly eventId?: string;
  readonly version?: number;
}

export interface OutboxInput {
  readonly commandId: string;
  readonly type: string;
  readonly threadId?: string | null;
  readonly payload?: unknown;
  /** ISO time; now unless set. */
  readonly availableAt?: string;
}

export interface OutboxEffect {
  readonly id: string;
  readonly commandId: string;
  readonly type: string;
  readonly threadId: string | null;
  readonly payload: unknown;
  readonly attempt: number;
}

/** The saved threads in the shape `data.load` returns (`SavedFiles`, src/host/types/data.ts). */
export interface SavedFiles {
  readonly index: string;
  readonly threads: ReadonlyArray<string>;
}

const SHELL_TYPES = new Set(['thread.saved', 'thread.deleted', 'projects.saved']);

type EventRow = { sequence: number; thread_id: string | null; event_type: string; payload_json: string };
const toEvent = (row: EventRow): LoggedEvent => ({ sequence: row.sequence, type: row.event_type, threadId: row.thread_id, payload: JSON.parse(row.payload_json) });
const now = () => new Date().toISOString();

/** `threadIds` of a `SavedIndex`; a legacy `threads.json` has none, its threads are inside it. */
const threadIdsOf = (index: string): string[] => {
  const ids = (JSON.parse(index) as { threadIds?: unknown }).threadIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
};

/**
 * Core's SQLite: the append-only `events` log with `command_receipts`, the `outbox`, the thread snapshots the renderer
 * saves, and one table of JSON documents per former JSON file. Committed events are published to the `shell` and `thread`
 * streams.
 */
export class Store extends Context.Service<Store>()('mochi/core/Store', {
  make: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const published = yield* PubSub.unbounded<LoggedEvent>();

    const insertEvent = (input: AppendInput) =>
      Effect.map(
        sql<{ sequence: number }>`INSERT INTO events (event_id, command_id, thread_id, event_type, version, occurred_at, payload_json)
          VALUES (${input.eventId ?? randomUUID()}, ${input.commandId ?? null}, ${input.threadId ?? null}, ${input.type}, ${input.version ?? 1}, ${now()}, ${JSON.stringify(input.payload ?? null)})
          RETURNING sequence`,
        (rows): LoggedEvent => ({ sequence: rows[0]!.sequence, type: input.type, threadId: input.threadId ?? null, payload: input.payload ?? null }),
      );

    /** Runs `work` in a transaction and publishes the events it logged once it committed. */
    const commit = <A, E, R>(work: Effect.Effect<{ result: A; events: ReadonlyArray<LoggedEvent> }, E, R>) =>
      sql.withTransaction(work).pipe(
        Effect.tap(({ events }) => PubSub.publishAll(published, events)),
        Effect.map(({ result }) => result),
      );

    const append = (input: AppendInput) =>
      commit(
        Effect.gen(function* () {
          if (input.eventId) {
            const [logged] = yield* sql<{ sequence: number }>`SELECT sequence FROM events WHERE event_id = ${input.eventId}`;
            if (logged) return { result: { sequence: logged.sequence, isDuplicate: true }, events: [] };
          }
          if (input.commandId) {
            const [receipt] = yield* sql<{ result_sequence: number }>`SELECT result_sequence FROM command_receipts WHERE command_id = ${input.commandId}`;
            if (receipt) return { result: { sequence: receipt.result_sequence, isDuplicate: true }, events: [] };
          }
          const event = yield* insertEvent(input);
          if (input.commandId)
            yield* sql`INSERT INTO command_receipts (command_id, thread_id, command_type, accepted_at, result_sequence)
              VALUES (${input.commandId}, ${input.threadId ?? null}, ${input.type}, ${now()}, ${event.sequence})`;
          return { result: { sequence: event.sequence, isDuplicate: false }, events: [event] };
        }),
      );

    const loadThreads = Effect.gen(function* () {
      const [index] = yield* sql<{ payload_json: string }>`SELECT payload_json FROM thread_index WHERE id = 1`;
      if (!index) return null;
      const rows = yield* sql<{ thread_id: string; payload_json: string }>`SELECT thread_id, payload_json FROM threads`;
      const byId = new Map(rows.map((row) => [row.thread_id, row.payload_json]));
      return { index: index.payload_json, threads: threadIdsOf(index.payload_json).flatMap((id) => byId.get(id) ?? []) } satisfies SavedFiles;
    });

    /** `changed` holds only the threads that changed, by id; a thread the index no longer lists is deleted. */
    const saveThreads = (index: string, changed: Readonly<Record<string, string>>) =>
      commit(
        Effect.gen(function* () {
          const ids = new Set(threadIdsOf(index));
          const events: LoggedEvent[] = [];
          for (const [id, json] of Object.entries(changed)) {
            const summary = summarizeThread(id, JSON.parse(json));
            const event = yield* insertEvent({ type: 'thread.saved', threadId: id, payload: summary });
            events.push(event);
            yield* sql`INSERT INTO threads (thread_id, sequence, title, status, project, payload_json, updated_at)
              VALUES (${id}, ${event.sequence}, ${summary.title}, ${summary.status}, ${summary.project}, ${json}, ${now()})
              ON CONFLICT (thread_id) DO UPDATE SET sequence = excluded.sequence, title = excluded.title, status = excluded.status,
                project = excluded.project, payload_json = excluded.payload_json, updated_at = excluded.updated_at`;
          }
          const stored = yield* sql<{ thread_id: string }>`SELECT thread_id FROM threads`;
          for (const { thread_id } of stored.filter((row) => !ids.has(row.thread_id))) {
            events.push(yield* insertEvent({ type: 'thread.deleted', threadId: thread_id }));
            yield* sql`DELETE FROM threads WHERE thread_id = ${thread_id}`;
          }
          yield* sql`INSERT INTO thread_index (id, payload_json, updated_at) VALUES (1, ${index}, ${now()})
            ON CONFLICT (id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`;
          return { result: undefined, events };
        }),
      );

    const listDocs = (table: DocTable) =>
      Effect.map(sql.unsafe<{ key: string; payload_json: string }>(`SELECT key, payload_json FROM ${checked(table)}`), (rows) =>
        rows.map((row) => ({ key: row.key, value: JSON.parse(row.payload_json) as unknown })),
      );

    const getDoc = (table: DocTable, key: string) =>
      Effect.map(sql.unsafe<{ payload_json: string }>(`SELECT payload_json FROM ${checked(table)} WHERE key = ?`, [key]), ([row]) =>
        row ? (JSON.parse(row.payload_json) as unknown) : undefined,
      );

    /** `undefined` deletes the document. Saving the project registry logs `projects.saved` for the shell. */
    const setDoc = (table: DocTable, key: string, value: unknown) =>
      commit(
        Effect.gen(function* () {
          if (value === undefined) yield* sql.unsafe(`DELETE FROM ${checked(table)} WHERE key = ?`, [key]);
          else
            yield* sql.unsafe(
              `INSERT INTO ${checked(table)} (key, payload_json, updated_at) VALUES (?, ?, ?)
               ON CONFLICT (key) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
              [key, JSON.stringify(value), now()],
            );
          const events = table === 'projects' ? [yield* insertEvent({ type: 'projects.saved', payload: { projects: summarizeProjects(value) } })] : [];
          return { result: undefined, events };
        }),
      );

    const enqueue = (input: OutboxInput) =>
      Effect.gen(function* () {
        const id = randomUUID();
        const at = now();
        yield* sql`INSERT INTO outbox (effect_id, command_id, thread_id, effect_type, payload_json, status, available_at, created_at, updated_at)
          VALUES (${id}, ${input.commandId}, ${input.threadId ?? null}, ${input.type}, ${JSON.stringify(input.payload ?? null)}, 'pending', ${input.availableAt ?? at}, ${at}, ${at})
          ON CONFLICT (command_id) DO NOTHING`;
        return id;
      });

    /** Marks up to `limit` due effects running and returns them, oldest first. */
    const claim = (limit: number) =>
      sql.withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<{ effect_id: string; command_id: string; thread_id: string | null; effect_type: string; payload_json: string; attempt_count: number }>`
            SELECT effect_id, command_id, thread_id, effect_type, payload_json, attempt_count FROM outbox
            WHERE status = 'pending' AND available_at <= ${now()} ORDER BY created_at, effect_id LIMIT ${limit}`;
          for (const row of rows) yield* sql`UPDATE outbox SET status = 'running', attempt_count = attempt_count + 1, updated_at = ${now()} WHERE effect_id = ${row.effect_id}`;
          return rows.map(
            (row): OutboxEffect => ({ id: row.effect_id, commandId: row.command_id, type: row.effect_type, threadId: row.thread_id, payload: JSON.parse(row.payload_json), attempt: row.attempt_count + 1 }),
          );
        }),
      );

    const complete = (id: string) => sql`UPDATE outbox SET status = 'succeeded', updated_at = ${now()}, last_error = NULL WHERE effect_id = ${id}`.pipe(Effect.asVoid);

    /** Drops the effect, so its `command_id` can be enqueued again. */
    const release = (id: string) => sql`DELETE FROM outbox WHERE effect_id = ${id}`.pipe(Effect.asVoid);

    /** With `retryAt` the effect is due again then; without, it failed for good. */
    const fail = (id: string, error: string, retryAt?: string) =>
      (retryAt
        ? sql`UPDATE outbox SET status = 'pending', available_at = ${retryAt}, last_error = ${error}, updated_at = ${now()} WHERE effect_id = ${id}`
        : sql`UPDATE outbox SET status = 'failed', last_error = ${error}, updated_at = ${now()} WHERE effect_id = ${id}`
      ).pipe(Effect.asVoid);

    // Whatever was running when Core last stopped runs again.
    yield* sql`UPDATE outbox SET status = 'pending' WHERE status = 'running'`;

    /** Projects and the thread list, then every later shell event. */
    const shell: Stream.Stream<ShellItem, unknown> = Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(published);
        const snapshot = yield* sql.withTransaction(
          Effect.gen(function* () {
            const [{ sequence }] = (yield* sql<{ sequence: number | null }>`SELECT MAX(sequence) AS sequence FROM events`) as [{ sequence: number | null }];
            const threads = yield* sql<{ thread_id: string; title: string | null; status: string | null; project: string | null }>`SELECT thread_id, title, status, project FROM threads`;
            return {
              sequence: sequence ?? 0,
              threads: threads.map((row) => ({ id: row.thread_id, title: row.title, status: row.status, project: row.project })),
              projects: summarizeProjects(yield* getDoc('projects', 'registry')),
            };
          }),
        );
        const live = Stream.fromSubscription(subscription).pipe(
          Stream.filter((event) => event.sequence > snapshot.sequence && SHELL_TYPES.has(event.type)),
          Stream.map((event): ShellItem => ({ _tag: 'event', event })),
        );
        return Stream.concat(Stream.succeed<ShellItem>({ _tag: 'snapshot', shell: snapshot }), live);
      }),
    );

    const snapshotOf = (threadId: string) =>
      Effect.gen(function* () {
        const [row] = yield* sql<{ sequence: number; payload_json: string }>`SELECT sequence, payload_json FROM threads WHERE thread_id = ${threadId}`;
        const sequence = row?.sequence ?? 0;
        const tail = yield* sql<EventRow>`SELECT sequence, thread_id, event_type, payload_json FROM events WHERE thread_id = ${threadId} AND sequence > ${sequence} ORDER BY sequence`;
        return [{ _tag: 'snapshot', sequence, saved: row ? (JSON.parse(row.payload_json) as unknown) : null }, ...tail.map((r) => ({ _tag: 'event', event: toEvent(r) }))] as ThreadItem[];
      });

    /** The events after `afterSequence` when few and small enough, else the snapshot and the events after it. */
    const catchUp = (threadId: string, afterSequence: number) =>
      sql.withTransaction(
        Effect.gen(function* () {
          if (afterSequence <= 0) return yield* snapshotOf(threadId);
          const rows = yield* sql<EventRow>`SELECT sequence, thread_id, event_type, payload_json FROM events
            WHERE thread_id = ${threadId} AND sequence > ${afterSequence} ORDER BY sequence LIMIT ${MAX_REPLAY_EVENTS + 1}`;
          const bytes = rows.reduce((sum, row) => sum + row.payload_json.length, 0);
          const isReplayable = rows.length <= MAX_REPLAY_EVENTS && bytes <= MAX_REPLAY_BYTES && !rows.some((row) => row.event_type === 'thread.saved');
          return isReplayable ? rows.map((row): ThreadItem => ({ _tag: 'event', event: toEvent(row) })) : yield* snapshotOf(threadId);
        }),
      );

    const lastSequence = (items: ReadonlyArray<ThreadItem>, after: number) =>
      items.reduce((max, item) => Math.max(max, item._tag === 'snapshot' ? item.sequence : item.event.sequence), after);

    /** One thread: a bounded replay after `afterSequence`, else a snapshot; then live events, a new save as a snapshot. */
    const thread = (threadId: string, afterSequence: number): Stream.Stream<ThreadItem, unknown> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(published);
          const items = yield* catchUp(threadId, afterSequence);
          const from = lastSequence(items, afterSequence);
          const live = Stream.fromSubscription(subscription).pipe(
            Stream.filter((event) => event.threadId === threadId && event.sequence > from),
            Stream.mapEffect((event) =>
              event.type === 'thread.saved'
                ? Effect.map(snapshotOf(threadId), ([snapshot]) => snapshot!)
                : Effect.succeed<ThreadItem>({ _tag: 'event', event }),
            ),
          );
          return Stream.concat(Stream.fromIterable(items), live);
        }),
      );

    return { events: Stream.fromPubSub(published), append, loadThreads, saveThreads, listDocs, getDoc, setDoc, enqueue, claim, complete, release, fail, shell, thread };
  }),
}) {
  /** The store and its `SqlClient`. */
  static readonly layer = (filename: string) =>
    Layer.effect(this, this.make).pipe(
      Layer.provide(layerSetup),
      Layer.provide(filename === ':memory:' ? Layer.empty : backupSchedule(filename)),
      // ponytail: no checkpoint worker; it needs SQLite's NOOP checkpoint, which Node 24's bundled SQLite 3.50 lacks, and
      // logs a fallback warning on every launch. Turn it on once Electron's Node ships SQLite ≥ 3.51.
      Layer.provideMerge(NodeSqliteClient.layer({ filename, readerWorker: true, checkpointWorker: false }).pipe(Layer.provide(restoreLayer(filename)))),
    );
}

const checked = (table: DocTable) => {
  if (!docTables.includes(table)) throw new TypeError(`No document table ${table}`);
  return table;
};

// Pragmas from T3 Code's `apps/server/src/persistence/Sqlite.ts`.
const layerSetup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA busy_timeout = 5000`;
    yield* sql`PRAGMA journal_mode = WAL`;
    // NORMAL syncs at checkpoints only: an app crash loses nothing, an OS crash can roll back commits since the last one.
    yield* sql`PRAGMA synchronous = NORMAL`;
    yield* sql`PRAGMA checkpoint_fullfsync = ON`;
    yield* migrate;
  }),
);
