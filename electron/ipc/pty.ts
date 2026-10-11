import type { PtyHost } from '../../src/host/types/pty.ts';
import { notImplemented, type Handlers } from './handlers.ts';

export const pty = {
  spawn: notImplemented('pty.spawn'),
  write: notImplemented('pty.write'),
  resize: notImplemented('pty.resize'),
  kill: notImplemented('pty.kill'),
} satisfies Handlers<PtyHost>;
