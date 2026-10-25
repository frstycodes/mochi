import type { PtyHost } from '@mochi/domain/host/types/pty';
import type { HostMethods } from '../hostMethods.ts';
import { resolveCwd } from './cwd.ts';
import { killSession, ownedSession, spawnSession } from './sessions.ts';

/** `host.pty`; shell integration files go under `userData`. */
export const ptyHost = (userData: string) =>
  ({
    async spawn(caller, options) {
      return spawnSession(caller, userData, {
        ...options,
        cwd: resolveCwd(options.cwd),
      });
    },
    async write(caller, id, data) {
      ownedSession(caller, id).write(data);
    },
    async resize(caller, id, cols, rows) {
      ownedSession(caller, id).resize(cols, rows);
    },
    async kill(caller, id) {
      killSession(caller, id);
    },
  }) satisfies HostMethods<PtyHost>;
