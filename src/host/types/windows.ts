import type { Manifest } from './manifest.ts';

export interface WindowsHost {
  /** `route` becomes the new window's location hash, e.g. `window/t1` → `#/window/t1`. A window already showing that route is focused instead. */
  open(route: string): Promise<void>;
  /** Delivers `message` to every other Harness window (desktop) or tab (web), never back to the sender. */
  broadcast(message: unknown): Promise<void>;
  onMessage(listener: (message: unknown) => void): () => void;
}

export const windowsMethods = {
  open: 'invoke',
  broadcast: 'invoke',
  onMessage: 'event',
} satisfies Manifest<WindowsHost>;
