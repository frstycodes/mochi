import type * as Relay from '../../packages/schema/src/relay.ts';
import type * as R from '../host/types/remote.ts';
import type { SentImage } from '../model.ts';
import type { Check, Decoded, Same } from './check.ts';

/** A device never names an image's `original` (a path on the machine): the relay schema drops it. */
type FromDevice<T> = T extends { type: 'create' } ? Omit<T, 'images'> & { images?: Omit<SentImage, 'original'>[] } : T;

export type Conformance = [
  Check<Same<Decoded<typeof Relay.RemoteCommand>, FromDevice<R.RemoteCommand>>>,
  Check<Same<Decoded<typeof Relay.ThreadPoint>, R.ThreadPoint>>,
  Check<Same<Decoded<typeof Relay.CommandResult>, R.CommandResult>>,
  Check<Same<Decoded<typeof Relay.MirrorFrame>, R.MirrorFrame>>,
  Check<Same<Decoded<typeof Relay.RemoteCommandRequest>, FromDevice<R.RemoteCommandRequest['command']> extends infer C ? Omit<R.RemoteCommandRequest, 'command'> & { command: C } : never>>,
  Check<Same<Decoded<typeof Relay.Scope>, R.Scope>>,
  Check<Same<Decoded<typeof Relay.DeviceKind>, R.DeviceKind>>,
];
