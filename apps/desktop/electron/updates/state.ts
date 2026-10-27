import type {
  ReleaseChannel,
  UpdateState,
} from '@mochi/domain/host/types/updates';

export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'not-available'; at: number }
  | { type: 'available'; version: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string; at: number }
  | { type: 'error'; message: string; at: number }
  | { type: 'channel'; channel: ReleaseChannel };

/** A nightly build's version carries `-nightly.<date>.<run>`; everything else came from a stable tag. */
export const channelOfVersion = (version: string): ReleaseChannel =>
  /-nightly\./.test(version) ? 'nightly' : 'stable';

/** electron-updater's feed for a channel: `latest*.yml` on the newest release, `nightly*.yml` on the newest prerelease. */
export const feedOf = (channel: ReleaseChannel) =>
  channel === 'nightly' ? 'nightly' : 'latest';

export function nextState(
  state: UpdateState,
  event: UpdaterEvent,
): UpdateState {
  // A downloaded update stays ready: later checks and their errors don't take back the restart prompt.
  if (state.status === 'ready' && event.type !== 'channel') return state;
  const { version, channel } = state;
  switch (event.type) {
    case 'checking': {
      const { error: _, ...rest } = state;
      return { ...rest, status: 'checking' };
    }
    case 'not-available':
      return { version, channel, status: 'up-to-date', checkedAt: event.at };
    case 'available':
      return {
        ...state,
        status: 'downloading',
        available: event.version,
        percent: 0,
      };
    case 'progress':
      return {
        ...state,
        status: 'downloading',
        percent: Math.round(event.percent),
      };
    case 'downloaded':
      return {
        version,
        channel,
        status: 'ready',
        available: event.version,
        checkedAt: event.at,
      };
    case 'error':
      return {
        version,
        channel,
        status: 'error',
        error: event.message,
        checkedAt: event.at,
      };
    case 'channel':
      return { version, channel: event.channel, status: 'idle' };
  }
}
