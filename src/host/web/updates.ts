import pkg from '../../../package.json' with { type: 'json' };
import type { UpdatesHost } from '../types/updates.ts';

// A web page updates by reloading; there is nothing to install.
const UNSUPPORTED = { version: pkg.version, status: 'unsupported' } as const;

export const updates: UpdatesHost = {
  get: async () => UNSUPPORTED,
  check: async () => UNSUPPORTED,
  install: async () => {
    throw new Error('Updates need the desktop app');
  },
  onChange: () => () => {},
};
