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

export const migrate = Migrator.make({})({
  loader: Migrator.fromRecord({
    '1_initial': initial,
    '2_outbox_command_unique': outboxCommandUnique,
    '3_snapshot_sequence': snapshotSequence,
  }),
});
