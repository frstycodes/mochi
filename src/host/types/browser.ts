import type { Manifest } from './manifest.ts';

export interface BrowserHost {
  create(url: string): Promise<{ id: string }>;
  navigate(id: string, url: string): Promise<void>;
}

export const browserMethods = {
  create: 'invoke',
  navigate: 'invoke',
} satisfies Manifest<BrowserHost>;
