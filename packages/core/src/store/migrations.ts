import { Effect } from 'effect';
import { Migrator, SqlClient } from 'effect/sql';

/** Tables holding one JSON document per key, each replacing one of the JSON files main used to write. */
export const docTables = [
  'settings',
  'projects',
  'schedule',
  'autofix',
  'library',
  'limits',
  'window_bounds',
] as const;
export type DocTable = (typeof docTables)[number];

// Shapes of `events`, `command_receipts` and `outbox` from T3 Code's `055_OrchestrationV2.ts` / `OrchestrationV2/Foundation.ts`.
const initial = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      command_id TEXT,
      thread_id TEXT,
      event_type TEXT NOT NULL,
      version INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX events_thread_sequence_idx ON events(thread_id, sequence)`;
  yield* sql`
    CREATE TABLE command_receipts (
      command_id TEXT PRIMARY KEY,
      thread_id TEXT,
      command_type TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      result_sequence INTEGER NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE outbox (
      effect_id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL,
      thread_id TEXT,
      effect_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT
    )
  `;
  yield* sql`CREATE INDEX outbox_status_available_idx ON outbox(status, available_at)`;
  yield* sql`
    CREATE TABLE threads (
      thread_id TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL,
      title TEXT,
      status TEXT,
      project TEXT,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  // The renderer's `SavedIndex` (src/store/saved.ts): one row.
  yield* sql`CREATE TABLE thread_index (id INTEGER PRIMARY KEY CHECK (id = 1), payload_json TEXT NOT NULL, updated_at TEXT NOT NULL)`;
  for (const table of docTables)
    yield* sql.unsafe(
      `CREATE TABLE ${table} (key TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    );
  yield* sql`CREATE TABLE imports (source TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT, at TEXT NOT NULL)`;
});

/**
 * Core writes the thread snapshots from its projection: the index records the log sequence they hold. A snapshot the renderer
 * saved held everything logged before it, so it starts at the log's end.
 */
const snapshotSequence = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE thread_index ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0`;
  yield* sql`UPDATE thread_index SET sequence = (SELECT COALESCE(MAX(sequence), 0) FROM events)`;
});

// The reactor enqueues a command once per `command_id`, however often its rule emits it.
const outboxCommandUnique = Effect.flatMap(
  SqlClient.SqlClient,
  (sql) => sql`CREATE UNIQUE INDEX outbox_command_idx ON outbox(command_id)`,
);

/**
 * A provider switch (`PROVIDER-SWITCH.md`): each provider session a thread used, with what it last saw of the log and the context
 * package it gets on every launch.
 */
const providerSwitch = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE thread_sessions (
      thread_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      native_session_id TEXT,
      model TEXT,
      last_seen_seq INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL CHECK (state IN ('active', 'detached', 'lost')),
      context TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, provider)
    )
  `;
});

/**
 * Sub-thread news used to wait in the parent's `live.notes` as `[Sub-thread "title" (id) …]` strings; it is now an event in the
 * parent's transcript (`subReport`). Each saved thread's such notes move there, undelivered, in order. Codex compaction-restore
 * notes share the field and stay.
 */
const subThreadReports = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    thread_id: string;
    payload_json: string;
  }>`SELECT thread_id, payload_json FROM threads`;
  for (const row of rows) {
    const moved = moveSubThreadNotes(JSON.parse(row.payload_json), Date.now());
    if (moved)
      yield* sql`UPDATE threads SET payload_json = ${JSON.stringify(moved)} WHERE thread_id = ${row.thread_id}`;
  }
});

const NOTE =
  /^\[(Sub-thread|Reply from thread) "(.*)" \(([^()\s]+)\) (.*?)\](?:\n([\s\S]*))?$/;
const URGENT = /^reported: (blocked|needs_input|failed)$/;

interface SavedThread {
  activity?: unknown[];
  live?: { notes?: string[] };
}

/** The thread with its sub-thread notes moved into its transcript, or undefined when it has none. */
export function moveSubThreadNotes(thread: SavedThread, at: number) {
  const notes = thread.live?.notes ?? [];
  const parsed = notes.map((n) => NOTE.exec(n));
  if (!parsed.some(Boolean)) return undefined;
  const kept = notes.filter((_, i) => !parsed[i]);
  const reports = parsed.flatMap((m) => {
    if (!m) return [];
    const [, kind, title, threadId, rest, body = ''] = m;
    const status = rest.replace(/^(ended a turn|reported): /, '');
    return [
      {
        at,
        who: 'harness',
        kind: 'event',
        text: body,
        subReport: {
          threadId,
          title,
          status,
          ...(URGENT.test(rest) && { isUrgent: true }),
          ...(kind === 'Reply from thread' && { isReply: true }),
        },
      },
    ];
  });
  return {
    ...thread,
    activity: [...(thread.activity ?? []), ...reports],
    live: { ...thread.live, notes: kept.length ? kept : undefined },
  };
}

export const migrate = Migrator.make({})({
  loader: Migrator.fromRecord({
    '1_initial': initial,
    '2_outbox_command_unique': outboxCommandUnique,
    '3_snapshot_sequence': snapshotSequence,
    '4_provider_switch': providerSwitch,
    '5_sub_thread_reports': subThreadReports,
  }),
});
