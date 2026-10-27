import type {
  UpdateState,
  UpdatesHost,
} from '@mochi/domain/host/types/updates';
import pkg from '../../../package.json';

// The web build is served, not installed: there is nothing for it to update.
const UNSUPPORTED: UpdateState = {
  channel: 'stable',
  version: pkg.version,
  status: 'unsupported',
};

export const updates: UpdatesHost = {
  get: async () => UNSUPPORTED,
  setChannel: async () => UNSUPPORTED,
  check: async () => UNSUPPORTED,
  install: async () => {},
  onChange: () => () => {},
};
