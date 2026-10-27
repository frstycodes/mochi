import type { UpdatesHost } from '@mochi/domain/host/types/updates';
import {
  checkForUpdates,
  installUpdate,
  setChannel,
  updateState,
} from '../updates/updater.ts';
import type { Handlers } from './handlers.ts';

export const updates = {
  get: async () => updateState(),
  setChannel: async (_sender, channel) => setChannel(channel),
  check: async () => checkForUpdates(),
  install: async () => installUpdate(),
} satisfies Handlers<UpdatesHost>;
