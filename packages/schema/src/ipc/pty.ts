import { Schema } from 'effect';
import { event, Int, invoke, Str } from '../checks.ts';

const opt = Schema.optional;
const T = Schema.Tuple;
const Size = Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 }));
const PtyId = Str(64);

export const PtySpawnOptions = Schema.Struct({
  cwd: Str(),
  cols: Size,
  rows: Size,
  command: opt(Str()),
  port: opt(Int.check(Schema.isBetween({ minimum: 1024, maximum: 65535 }))),
  threadId: Str(256),
});
export type PtySpawnOptions = typeof PtySpawnOptions.Type;

export const PtyData = Schema.Struct({
  id: Schema.String,
  data: Schema.String,
});
export const PtyExit = Schema.Struct({
  id: Schema.String,
  exitCode: Schema.Number,
});

/** `PtyHost` (`src/host/types/pty.ts`). Main still checks the cwd is a folder and the session is the sender's. */
export const ptyRpc = {
  spawn: invoke(T([PtySpawnOptions]), Schema.Struct({ id: Schema.String })),
  write: invoke(T([PtyId, Str(1_000_000)]), Schema.Void),
  resize: invoke(T([PtyId, Size, Size]), Schema.Void),
  kill: invoke(T([PtyId]), Schema.Void),
  onData: event(PtyData),
  onExit: event(PtyExit),
};
