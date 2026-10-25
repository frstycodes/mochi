import type { BrowserHost } from '@mochi/domain/host/types/browser';
import { desktopNamespace } from './rpc.ts';

export const browser = (): BrowserHost => desktopNamespace('browser');
