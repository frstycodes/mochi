import type { PtyHost } from '@mochi/domain/host/types/pty';
import { desktopNamespace } from './rpc.ts';

export const pty = (): PtyHost => desktopNamespace('pty');
