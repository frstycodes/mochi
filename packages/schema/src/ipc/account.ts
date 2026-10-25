import { Schema } from 'effect';
import { event, invoke } from '../checks.ts';

const opt = Schema.optional;
const T = Schema.Tuple;

export const MochiUser = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(Schema.String),
});
export type MochiUser = typeof MochiUser.Type;

export const MochiAccount = Schema.Struct({
  status: Schema.Literals([
    'unconfigured',
    'signed-out',
    'signing-in',
    'signed-in',
  ]),
  user: opt(MochiUser),
  isPersistent: Schema.Boolean,
});
export type MochiAccount = typeof MochiAccount.Type;

/** `AccountHost` (`src/host/types/account.ts`). */
export const accountRpc = {
  get: invoke(T([]), MochiAccount),
  signIn: invoke(T([]), MochiAccount),
  cancelSignIn: invoke(T([]), Schema.Void),
  signOut: invoke(T([]), MochiAccount),
  openAccountPortal: invoke(T([]), Schema.Void),
  onChange: event(MochiAccount),
};
