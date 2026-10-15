import type { PtyHost } from '../../src/host/types/pty.ts';
import { resolveCwd } from '../pty/cwd.ts';
import { ownedSession, spawnSession } from '../pty/sessions.ts';
import { integer, record, string, type Handlers } from './handlers.ts';

export const pty = {
  async spawn(sender, options) {
    const { cwd, cols, rows, command, port, threadId } = record(options, 'options');
    return spawnSession(sender, {
      cwd: resolveCwd(cwd),
      cols: integer(cols, 'cols', 1, 1000),
      rows: integer(rows, 'rows', 1, 1000),
      command: command === undefined ? undefined : string(command, 'command'),
      port: port === undefined ? undefined : integer(port, 'port', 1024, 65535),
      threadId: string(threadId, 'threadId', 256),
    });
  },
  async write(sender, id, data) {
    ownedSession(sender, string(id, 'id', 64)).write(string(data, 'data', 1_000_000));
  },
  async resize(sender, id, cols, rows) {
    ownedSession(sender, string(id, 'id', 64)).resize(integer(cols, 'cols', 1, 1000), integer(rows, 'rows', 1, 1000));
  },
  async kill(sender, id) {
    ownedSession(sender, string(id, 'id', 64)).kill();
  },
} satisfies Handlers<PtyHost>;
