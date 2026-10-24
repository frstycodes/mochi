import { Schema } from 'effect';
import { event, Int, invoke, Str } from '../checks.ts';
import { AutofixTarget } from '../model.ts';

const opt = Schema.optional;
const T = Schema.Tuple;
const S = Schema.String;
const B = Schema.Boolean;
/** Main refuses longer lists (`list`). */
const List = <I extends Schema.Top>(item: I) => Schema.Array(item).check(Schema.isMaxLength(10_000));
const ThreadId = Str(256);
const GithubUser = opt(Str(128));

export const Notice = Schema.Struct({ title: Str(200), body: opt(Str(2000)), id: opt(Str(200)) });
export type Notice = typeof Notice.Type;

export const WatchedThread = Schema.Struct({ id: ThreadId, title: Str(500), cwd: opt(Str()), githubUser: GithubUser });

export const QuietHours = Schema.Struct({ isOn: B, start: Int.check(Schema.isBetween({ minimum: 0, maximum: 23 })), end: Int.check(Schema.isBetween({ minimum: 0, maximum: 23 })) });
export type QuietHours = typeof QuietHours.Type;

/** `AutofixTarget` with the limits main's `watchConfig` checks. */
const WatchedAutofix = Schema.Struct({
  ...AutofixTarget.fields,
  threadId: ThreadId,
  title: Str(500),
  pr: Int.check(Schema.isBetween({ minimum: 1, maximum: 1e9 })),
  cwd: Str(),
  githubUser: GithubUser,
  since: Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
});

export const WatchConfig = Schema.Struct({
  threads: List(WatchedThread),
  autofix: List(WatchedAutofix),
  kinds: List(Str(64)),
  quiet: QuietHours,
  muted: List(ThreadId),
  needsYou: List(ThreadId),
  dockBadge: B,
});
export type WatchConfig = typeof WatchConfig.Type;

export const ThreadAddressed = Schema.Struct({ threadId: ThreadId, isViewed: opt(B), isActedOn: opt(B) });

export const NotifyPermission = Schema.Literals(['granted', 'denied', 'default']);

/** `NotifyHost` (`src/host/types/notify.ts`). */
export const notifyRpc = {
  show: invoke(T([Notice]), Schema.Void),
  close: invoke(T([List(Str(200))]), Schema.Void),
  addressed: invoke(T([ThreadAddressed]), Schema.Void),
  watch: invoke(T([WatchConfig]), Schema.Void),
  pendingOpen: invoke(T([]), Schema.NullOr(S)),
  permission: invoke(T([]), NotifyPermission),
  requestPermission: invoke(T([]), NotifyPermission),
  onClick: event(S),
  onOpenThread: event(S),
  haptic: invoke(T([]), Schema.Void),
};
