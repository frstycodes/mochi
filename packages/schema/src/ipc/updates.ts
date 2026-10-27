import { Schema } from 'effect';
import { event, invoke } from '../checks.ts';

const opt = Schema.optional;
const T = Schema.Tuple;

export const ReleaseChannel = Schema.Literals(['stable', 'nightly']);

export const UpdateState = Schema.Struct({
  channel: ReleaseChannel,
  version: Schema.String,
  status: Schema.Literals([
    'unsupported',
    'idle',
    'checking',
    'up-to-date',
    'downloading',
    'ready',
    'error',
  ]),
  available: opt(Schema.String),
  percent: opt(Schema.Number),
  error: opt(Schema.String),
  checkedAt: opt(Schema.Number),
});
export type UpdateState = typeof UpdateState.Type;

/** `UpdatesHost` (`@mochi/domain/host/types/updates`). */
export const updatesRpc = {
  get: invoke(T([]), UpdateState),
  setChannel: invoke(T([ReleaseChannel]), UpdateState),
  check: invoke(T([]), UpdateState),
  install: invoke(T([]), Schema.Void),
  onChange: event(UpdateState),
};
