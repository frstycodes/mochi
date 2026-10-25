import { Schema } from 'effect';
import { Git, Ports, Sim } from '@mochi/schema';

// No node built-ins here: windows import it through rpc.ts.

const Path = Schema.String.check(Schema.isMaxLength(4096));

/** What a `watch` subscription follows. Subscribers of an equal key share one reader in Core. */
export const WatchKey = Schema.Union([
  /** The root's file list (`.gitignore` honoured), re-listed when a file is created or deleted under it. */
  Schema.TaggedStruct('files', { root: Path }),
  /** Paths (relative, `/`-separated) changed under the root, in batches; nothing is read. */
  Schema.TaggedStruct('changes', { root: Path }),
  /** The worktree's diff, re-read only when its `git status` fingerprint changed. */
  Schema.TaggedStruct('gitDiff', {
    cwd: Path,
    scope: Git.DiffScope,
    base: Schema.optional(Schema.String.check(Schema.isMaxLength(255))),
  }),
  /** Dev servers listening under `cwd`, from one app-wide `lsof` shared by every subscriber. */
  Schema.TaggedStruct('ports', { cwd: Path }),
  Schema.TaggedStruct('sim', {}),
]);
export type WatchKey = typeof WatchKey.Type;

/** A read that failed is a value, not the end of the stream: the next trigger reads again. */
export const WatchValue = Schema.Union([
  Schema.TaggedStruct('files', { files: Schema.Array(Schema.String) }),
  Schema.TaggedStruct('changes', { paths: Schema.Array(Schema.String) }),
  Schema.TaggedStruct('gitDiff', { diff: Git.GitDiff }),
  Schema.TaggedStruct('ports', { listing: Ports.PortsListing }),
  Schema.TaggedStruct('sim', { simulators: Schema.Array(Sim.Simulator) }),
  Schema.TaggedStruct('error', { message: Schema.String }),
]);
export type WatchValue = typeof WatchValue.Type;

/** What `watch.stale` re-reads: an agent's tool ended (git, ports), or a user asked for a refresh. */
export const StaleKind = Schema.Literals(['git', 'files', 'ports', 'sim']);
export type StaleKind = typeof StaleKind.Type;

/** Main's report of what the user can see. Hidden or on battery stretches intervals; asleep stops every read until it wakes. */
export const Gate = Schema.Struct({
  isVisible: Schema.Boolean,
  isAsleep: Schema.Boolean,
  isOnBattery: Schema.Boolean,
});
export type Gate = typeof Gate.Type;
