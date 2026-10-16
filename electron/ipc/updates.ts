import type { UpdatesHost } from '../../src/host/types/updates.ts';
import { check, current, install } from '../updates/updater.ts';
import type { Handlers } from './handlers.ts';

export const updates = {
  get: async () => current(),
  check,
  install,
} satisfies Handlers<UpdatesHost>;
