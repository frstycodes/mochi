import type { BrowserHost } from '../types/browser.ts';
import { desktopNamespace } from './rpc.ts';

export const browser = (): BrowserHost => desktopNamespace('browser');
