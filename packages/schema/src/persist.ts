import { Schema } from 'effect';
import { QueueItem, QueueKind, Step, Thread } from './model.ts';
import { upgrade } from './version.ts';

const opt = Schema.optional;

export const Checkpoint = Schema.Struct({
  n: Schema.Number,
  at: Schema.Number,
  label: Schema.String,
  stepId: opt(Schema.String),
  thread: Thread,
  ref: opt(Schema.String),
  wantsFiles: opt(Schema.Boolean),
  before: opt(Schema.Number),
});
export type Checkpoint = typeof Checkpoint.Type;

export const Fork = Schema.Struct({
  parentId: Schema.String,
  at: Schema.Number,
  label: Schema.String,
  checkpoint: opt(Schema.Number),
});
export type Fork = typeof Fork.Type;

// Files written before `v`. Their threads may hold steps an overlap held (`waiting`, a status that went with overlaps) and
// their queue overlap cards; both read as today's shapes: the step is up next again, the card has nothing left to answer it.
const LegacyStep = Schema.Struct({
  ...Step.fields,
  status: Schema.Union([Step.fields.status, Schema.Literal('waiting')]),
});
const LegacyThread = Schema.Struct({
  ...Thread.fields,
  steps: Schema.Array(LegacyStep),
});
const LegacyCheckpoint = Schema.Struct({
  ...Checkpoint.fields,
  thread: LegacyThread,
});
const LegacyQueueItem = Schema.Struct({
  ...QueueItem.fields,
  kind: Schema.Union([QueueKind, Schema.Literal('overlap')]),
});
const NO_V = { v: opt(Schema.Never) };
// The `down`s below never run: the unions encode through their current member first. Encoded and legacy decoded shapes differ
// (`ThreadControls.speed`), hence `as never`.

type LegacyThread = typeof LegacyThread.Type;
type LegacyQueueItem = typeof LegacyQueueItem.Type;

const liftThread = (thread: LegacyThread): Thread => ({
  ...thread,
  steps: thread.steps.map((s) =>
    s.status === 'waiting'
      ? { ...s, status: 'ready' }
      : { ...s, status: s.status },
  ),
});
const liftCheckpoints = <C extends { thread: LegacyThread }>(
  list: readonly C[],
) => list.map((c) => ({ ...c, thread: liftThread(c.thread) }));
const liftQueue = (queue: readonly LegacyQueueItem[]): QueueItem[] =>
  queue.flatMap((q) => (q.kind === 'overlap' ? [] : [{ ...q, kind: q.kind }]));

/** One thread's JSON, stored whole as its `threads` row's `payload_json` in Core's SQLite. */
const SavedThreadV1 = Schema.Struct({
  v: Schema.Literal(1),
  thread: Thread,
  checkpoints: opt(Schema.Array(Checkpoint)),
  fork: opt(Fork),
  /** The thread's open approvals and questions, so a `thread` stream carries them to devices; the index holds the same items. */
  queue: opt(Schema.Array(QueueItem)),
});
const LegacySavedThread = Schema.Struct({
  ...NO_V,
  thread: LegacyThread,
  checkpoints: opt(Schema.Array(LegacyCheckpoint)),
  fork: opt(Fork),
  queue: opt(Schema.Array(LegacyQueueItem)),
});

export const SavedThread = Schema.Union([
  SavedThreadV1,
  upgrade(
    LegacySavedThread,
    SavedThreadV1,
    ({ thread, checkpoints, fork, queue }) => ({
      v: 1 as const,
      thread: liftThread(thread),
      ...(checkpoints && { checkpoints: liftCheckpoints(checkpoints) }),
      ...(fork && { fork }),
      ...(queue && { queue: liftQueue(queue) }),
    }),
    ({ v: _, ...rest }) => rest as never,
  ),
]);
// The current member's type: declaration emit inlines both union members, so `typeof SavedThread.Type` is a union of two copies.
export type SavedThread = typeof SavedThreadV1.Type;

const indexFields = {
  now: Schema.Number,
  seq: Schema.Number,
  checkpointSeq: Schema.Number,
  threadIds: Schema.Array(Schema.String),
};

/** The index JSON: everything but the threads, which it lists by id. */
const SavedIndexV1 = Schema.Struct({
  v: Schema.Literal(1),
  ...indexFields,
  queue: Schema.Array(QueueItem),
});
const LegacySavedIndex = Schema.Struct({
  version: Schema.Literal(1),
  ...indexFields,
  queue: Schema.Array(LegacyQueueItem),
});

export const SavedIndex = Schema.Union([
  SavedIndexV1,
  upgrade(
    LegacySavedIndex,
    SavedIndexV1,
    ({ version: _, queue, ...rest }) => ({
      ...rest,
      v: 1 as const,
      queue: liftQueue(queue),
    }),
    ({ v: _, ...rest }) => ({ ...rest, version: 1 }) as never,
  ),
]);
export type SavedIndex = typeof SavedIndexV1.Type;

/** What the desktop app saves between launches, joined from the index and thread JSON (`src/store/saved.ts` `Saved`). */
const SavedV1 = Schema.Struct({
  v: Schema.Literal(1),
  now: Schema.Number,
  seq: Schema.Number,
  threads: Schema.Array(Thread),
  queue: Schema.Array(QueueItem),
  checkpoints: Schema.Record(Schema.String, Schema.Array(Checkpoint)),
  checkpointSeq: Schema.Number,
  forks: Schema.Record(Schema.String, Fork),
});

// A `threads.json` from before the split holds the whole save; older ones may predate checkpoints and forks (`joinSaved`).
const LegacySaved = Schema.Struct({
  version: Schema.Literal(1),
  now: Schema.Number,
  seq: Schema.Number,
  threads: Schema.Array(LegacyThread),
  queue: Schema.Array(LegacyQueueItem),
  checkpoints: opt(
    Schema.Record(Schema.String, Schema.Array(LegacyCheckpoint)),
  ),
  checkpointSeq: opt(Schema.Number),
  forks: opt(Schema.Record(Schema.String, Fork)),
});

export const Saved = Schema.Union([
  SavedV1,
  upgrade(
    LegacySaved,
    SavedV1,
    ({
      version: _,
      threads,
      queue,
      checkpoints = {},
      checkpointSeq = 0,
      forks = {},
      ...rest
    }) => ({
      ...rest,
      v: 1 as const,
      threads: threads.map(liftThread),
      queue: liftQueue(queue),
      checkpoints: Object.fromEntries(
        Object.entries(checkpoints).map(([id, list]) => [
          id,
          liftCheckpoints(list),
        ]),
      ),
      checkpointSeq,
      forks,
    }),
    ({ v: _, ...rest }) => ({ ...rest, version: 1 }) as never,
  ),
]);
export type Saved = typeof SavedV1.Type;
