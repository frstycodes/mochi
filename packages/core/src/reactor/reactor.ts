import { randomUUID } from 'node:crypto';
import { Effect, Stream } from 'effect';
import { SqlClient } from 'effect/sql';
import type { LoggedEvent } from '@mochi/domain';
import type { QueueItem, Thread } from '../../../../src/model.ts';
import { Store, type OutboxEffect } from '../store/store.ts';
import type { ReactorCommand } from './commands.ts';
import { react, type ReactorState } from './rules.ts';
import { outboxWorker, type Outcome } from './worker.ts';

// GAP: the state is the renderer's last save of each thread (`thread.saved`, debounced 500ms), not a projection of the event
// log: `replica` moves the threads reducer into packages/domain. Until then a rule sees a thread up to one save behind, and
// each window-side executor re-checks against the window's own state.

/**
 * Core's reactor: every logged event runs the rules registered for its type against the state before and after it; the
 * commands they emit go to the outbox, once per key, and `execute` runs them, retried across restarts.
 */
export const runReactor = (execute: (effect: OutboxEffect) => Effect.Effect<Outcome, unknown>) =>
  Effect.gen(function* () {
    const store = yield* Store;
    const sql = yield* SqlClient.SqlClient;
    // Keys this run already enqueued: a rule emits a due command on every save, and only the first needs the database.
    const enqueued = new Set<string>();
    const worker = yield* outboxWorker(store, execute, (key) => enqueued.delete(key));
    let state: ReactorState = { threads: yield* savedThreads(sql), queue: yield* savedQueue(sql), boot: randomUUID() };

    const enqueue = (command: ReactorCommand) =>
      Effect.gen(function* () {
        if (enqueued.has(command.key)) return;
        enqueued.add(command.key);
        const availableAt = command.type === 'limit.resume' ? command.resetsAt : undefined;
        yield* store.enqueue({ commandId: command.key, type: command.type, threadId: command.threadId, payload: command, ...(availableAt && { availableAt }) });
        yield* availableAt ? worker.wakeAt(Date.parse(availableAt)) : worker.wake;
      });

    const onEvent = (event: LoggedEvent) =>
      Effect.gen(function* () {
        const before = state;
        state = yield* next(sql, before, event);
        for (const command of react(event, before, state)) yield* enqueue(command);
      }).pipe(Effect.catchCause((cause) => Effect.logError(`Reactor failed on ${event.type}`, cause).pipe(Effect.annotateLogs({ source: 'reactor' }))));

    // Started now, so the subscription exists before anything this run appends.
    yield* Effect.forkScoped(Stream.runForEach(store.events, onEvent), { startImmediately: true });
  });

const next = (sql: SqlClient.SqlClient, state: ReactorState, event: LoggedEvent) =>
  Effect.gen(function* () {
    const id = event.threadId;
    if (event.type === 'thread.deleted') return { ...state, threads: state.threads.filter((t) => t.id !== id) };
    if (event.type !== 'thread.saved' || !id) return state;
    const [row] = yield* sql<{ payload_json: string }>`SELECT payload_json FROM threads WHERE thread_id = ${id}`;
    const saved = row && threadOf(row.payload_json);
    const others = state.threads.filter((t) => t.id !== id);
    return { ...state, threads: saved ? [...others, saved] : others, queue: yield* savedQueue(sql) };
  });

const savedThreads = (sql: SqlClient.SqlClient) =>
  Effect.map(sql<{ payload_json: string }>`SELECT payload_json FROM threads`, (rows) => rows.flatMap((row) => threadOf(row.payload_json) ?? []));

/** The index's `queue` (approvals and questions waiting on you): the queue runner and wakes hold for them. */
const savedQueue = (sql: SqlClient.SqlClient) =>
  Effect.map(sql<{ payload_json: string }>`SELECT payload_json FROM thread_index WHERE id = 1`, ([row]) => {
    const queue = row && (JSON.parse(row.payload_json) as { queue?: unknown }).queue;
    return Array.isArray(queue) ? (queue as QueueItem[]) : [];
  });

/** A saved thread file (`SavedThread`, src/store/persist.ts) holds the thread under `thread`. */
const threadOf = (json: string) => {
  const thread = (JSON.parse(json) as { thread?: Thread }).thread;
  return thread && typeof thread.id === 'string' ? thread : undefined;
};
