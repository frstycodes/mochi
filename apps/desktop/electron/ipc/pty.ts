import type { PtyHost } from '@mochi/domain/host/types/pty';
import { resolveCwd } from '../pty/cwd.ts';
import { ownedSession, spawnSession } from '../pty/sessions.ts';
import type { Handlers } from './handlers.ts';

export const pty = {
  async spawn(sender, options) {
    return spawnSession(sender, { ...options, cwd: resolveCwd(options.cwd) });
  },
  async write(sender, id, data) {
    ownedSession(sender, id).write(data);
  },
  async resize(sender, id, cols, rows) {
    ownedSession(sender, id).resize(cols, rows);
  },
  async kill(sender, id) {
    ownedSession(sender, id).kill();
  },
} satisfies Handlers<PtyHost>;
