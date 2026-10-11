import type { BrowserHost } from '../../src/host/types/browser.ts';
import { notImplemented, type Handlers } from './handlers.ts';

export const browser = {
  create: notImplemented('browser.create'),
  navigate: notImplemented('browser.navigate'),
} satisfies Handlers<BrowserHost>;
