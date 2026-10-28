import type { SettingsHost } from '../../src/host/types/settings.ts';
import type { InMain } from '@mochi/core/settings/host';
import { listSystemFonts } from '../fonts/systemFonts.ts';
import type { Handlers } from './handlers.ts';

// Core serves the rest of `host.settings` (packages/core/src/settings/host.ts).
export const settings = {
  async systemFonts() {
    return listSystemFonts();
  },
} satisfies Handlers<Pick<SettingsHost, InMain>>;
