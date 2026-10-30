import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { docTables } from './migrations.ts';

const Nullable = Schema.NullOr(Schema.String);

const LoggedEvent = Schema.Struct({
  sequence: Schema.Number,
  type: Schema.String,
  threadId: Nullable,
  payload: Schema.Unknown,
  at: Schema.optional(Schema.Number),
  commandId: Schema.optional(Nullable),
});
const ThreadSummary = Schema.Struct({
  id: Schema.String,
  title: Nullable,
  status: Nullable,
  project: Nullable,
});
const ProjectSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  space: Schema.String,
});

// `type` is any string, so an event this client doesn't know still decodes and advances its cursor (`projectShell`).
export const ShellItem = Schema.Union([
  Schema.TaggedStruct('snapshot', {
    shell: Schema.Struct({
      sequence: Schema.Number,
      threads: Schema.Array(ThreadSummary),
      projects: Schema.Array(ProjectSummary),
    }),
  }),
  Schema.TaggedStruct('event', { event: LoggedEvent }),
]);

export const ThreadItem = Schema.Union([
  Schema.TaggedStruct('snapshot', {
    sequence: Schema.Number,
    saved: Schema.Unknown,
  }),
  Schema.TaggedStruct('event', { event: LoggedEvent }),
]);

// `saved` and `context` are decoded by the window (`Persist.Saved`, src/store/replica.ts), where the store's types live.
export const ReplicaItem = Schema.Union([
  Schema.TaggedStruct('snapshot', {
    sequence: Schema.Number,
    saved: Schema.Unknown,
    context: Schema.Unknown,
    parts: Schema.optional(Schema.Number),
  }),
  Schema.TaggedStruct('checkpoints', {
    threadId: Schema.String,
    checkpoints: Schema.Unknown,
  }),
  Schema.TaggedStruct('event', { event: LoggedEvent }),
]);

const DocTable = Schema.Literals(docTables);

/** Core's store. A failure crosses as its message. */
export class StoreRpcs extends RpcGroup.make(
  Rpc.make('shell', { success: ShellItem, error: Schema.String, stream: true }),
  Rpc.make('thread', {
    payload: { threadId: Schema.String, afterSequence: Schema.Number },
    success: ThreadItem,
    error: Schema.String,
    stream: true,
  }),
  /** The whole thread projection for a window's store (`Projection.replica`). */
  Rpc.make('replica', {
    payload: { afterSequence: Schema.Number },
    success: ReplicaItem,
    error: Schema.String,
    stream: true,
  }),
  Rpc.make('events.append', {
    payload: {
      type: Schema.String,
      threadId: Schema.optional(Nullable),
      payload: Schema.Unknown,
      commandId: Schema.optional(Schema.String),
      eventId: Schema.optional(Schema.String),
    },
    success: Schema.Struct({
      sequence: Schema.Number,
      isDuplicate: Schema.Boolean,
    }),
    error: Schema.String,
  }),
  Rpc.make('docs.list', {
    payload: { table: DocTable },
    success: Schema.Array(
      Schema.Struct({ key: Schema.String, value: Schema.Unknown }),
    ),
    error: Schema.String,
  }),
  Rpc.make('docs.get', {
    payload: { table: DocTable, key: Schema.String },
    success: Schema.Unknown,
    error: Schema.String,
  }),
  /** An absent `value` deletes the document. */
  Rpc.make('docs.set', {
    payload: {
      table: DocTable,
      key: Schema.String,
      value: Schema.optional(Schema.Unknown),
    },
    error: Schema.String,
  }),
) {}
