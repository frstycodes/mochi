import { Schema } from 'effect';
import { invoke, Str } from '../checks.ts';
import { AgentImage } from '../model.ts';

const T = Schema.Tuple;
const o = Schema.optional;

// One IPC string; no replay export comes near it.
const MAX_CHARS = 64 * 1024 * 1024;
/** Per thread; main refuses appends past it and writes one `capped` line. */
export const MAX_REPLAY_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5_000_000;

/** It names the thread's replay file. */
const ReplayThreadId = Str(128).check(Schema.isPattern(/^[\w-]+$/));

/** `DataHost` (`src/host/types/data.ts`). */
export const dataRpc = {
  loadReplay: invoke(T([ReplayThreadId]), Schema.NullOr(Schema.String)),
  appendReplay: invoke(T([ReplayThreadId, Str(MAX_REPLAY_BYTES)]), Schema.Boolean),
  replayUsage: invoke(T([]), Schema.Struct({ threads: Schema.Number, bytes: Schema.Number })),
  clearReplays: invoke(T([o(Schema.Array(ReplayThreadId).check(Schema.isMaxLength(10_000)))]), Schema.Void),
  exportReplay: invoke(T([Str(MAX_CHARS), Str(512)]), Schema.NullOr(Schema.String)),
  saveImage: invoke(T([AgentImage.fields.mediaType, Str(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4)]), Schema.String),
};

