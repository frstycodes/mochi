import type { PtyHost } from '../types/pty.ts';
import { desktopNamespace } from './rpc.ts';

export const pty = (): PtyHost => desktopNamespace('pty');
