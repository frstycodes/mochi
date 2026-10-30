import { Schema, Struct } from 'effect';
import { QueueItem, QueueKind, Step, Thread } from './model.ts';
import { upgrade } from './version.ts';

const opt = Schema.optional;

/**
 * The thread as a checkpoint keeps it: without what only grows (`activity`, `subagents`) or follows the live session (`agent`,
 * `setup`), which `checkpointThread` (`src/rewind/checkpoints.ts`) takes from the thread now.
 */
export const CheckpointThread = Thread.mapFields(
  Struct.omit(['activity', 'subagents', 'agent', 'setup']),
);

const checkpointFields = {
  n: Schema.Number,
  at: Schema.Number,
  label: Schema.String,
  stepId: opt(Schema.String),
  ref: opt(Schema.String),
  wantsFiles: opt(Schema.Boolean),
  before: opt(Schema.Number),
};

// The counts lead: a checkpoint saved whole lacks them, so it fails here before its thread is checked.
const CheckpointV2 = Schema.Struct({
  activityCount: Schema.Number,
  subagentCount: Schema.Number,
  ...checkpointFields,
  thread: CheckpointThread,
});

// Saved before checkpoints left out what the live thread holds: each copied its whole thread, most of the store.
const SavedWholeCheckpoint = Schema.Struct({
  ...checkpointFields,
  thread: Thread,
});

/** Drops what the live thread holds from a checkpoint saved with its whole thread. */
const slimCheckpoint = ({
  thread: { activity, subagents, agent: _agent, setup: _setup, ...thread },
  ...rest
}: typeof SavedWholeCheckpoint.Type) => ({
  ...rest,
  activityCount: activity.length,
  subagentCount: subagents?.length ?? 0,
  thread,
});

export type Checkpoint = typeof CheckpointV2.Type;
// Annotated: declaration emit inlines both union members, which reaches dependents of `Checkpoint` as `any`.
export const Checkpoint: Schema.Codec<
  Checkpoint,
  typeof CheckpointV2.Encoded | typeof SavedWholeCheckpoint.Encoded
> = Schema.Union([
  CheckpointV2,
  upgrade(
    SavedWholeCheckpoint,
    CheckpointV2,
    (old) => slimCheckpoint(old) as never,
    (current) => current as never,
  ),
]);

export const Fork = Schema.Struct({
  parentId: Schema.String,
  at: Schema.Number,
  label: Schema.String,
  checkpoint: opt(Schema.Number),
});
export type Fork = typeof Fork.Type;

/** A selection a side chat question quotes (`src/store/sidechat.ts` `Quote`). */
export const Quote = Schema.Struct({
  source: Schema.Literals(['diff', 'terminal', 'file']),
  label: Schema.String,
  text: Schema.String,
});

export const SideMessage = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(['user', 'assistant']),
  text: Schema.String,
  quote: opt(Quote),
  isStreaming: opt(Schema.Boolean),
  promotedTo: opt(Schema.Literals(['message', 'thread'])),
});

/** The side chat other computers ask on a thread, run here (`src/store/remoteSideChat.ts`); saved with its thread so they follow it. */
export const RemoteSideChat = Schema.Struct({
  messages: Schema.Array(SideMessage),
});

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
  ...checkpointFields,
  thread: LegacyThread,
});
// Thread files carry no `v` yet, so today's saves read through the legacy shapes too: their checkpoints are slim or whole.
const UnversionedCheckpoint = Schema.Union([CheckpointV2, LegacyCheckpoint]);
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
const liftCheckpoints = (
  list: readonly (typeof UnversionedCheckpoint.Type)[],
): Checkpoint[] =>
  list.map((c) =>
    'activityCount' in c
      ? c
      : slimCheckpoint({ ...c, thread: liftThread(c.thread) }),
  );
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
  sideChat: opt(RemoteSideChat),
});
const LegacySavedThread = Schema.Struct({
  ...NO_V,
  thread: LegacyThread,
  checkpoints: opt(Schema.Array(UnversionedCheckpoint)),
  fork: opt(Fork),
  queue: opt(Schema.Array(LegacyQueueItem)),
  sideChat: opt(RemoteSideChat),
});

export const SavedThread = Schema.Union([
  SavedThreadV1,
  upgrade(
    LegacySavedThread,
    SavedThreadV1,
    ({ thread, checkpoints, fork, queue, sideChat }) => ({
      v: 1 as const,
      thread: liftThread(thread),
      ...(checkpoints && { checkpoints: liftCheckpoints(checkpoints) }),
      ...(fork && { fork }),
      ...(queue && { queue: liftQueue(queue) }),
      ...(sideChat && { sideChat }),
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
  remoteSideChats: opt(Schema.Record(Schema.String, RemoteSideChat)),
});

// A `threads.json` from before the split holds the whole save; older ones may predate checkpoints and forks (`joinSaved`).
const LegacySaved = Schema.Struct({
  version: Schema.Literal(1),
  now: Schema.Number,
  seq: Schema.Number,
  threads: Schema.Array(LegacyThread),
  queue: Schema.Array(LegacyQueueItem),
  checkpoints: opt(
    Schema.Record(Schema.String, Schema.Array(UnversionedCheckpoint)),
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
