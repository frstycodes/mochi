import type { Manifest } from './manifest.ts';

export interface WindowsHost {
  /** `route` becomes the new window's location hash, e.g. `stage/t1` → `#/stage/t1`. */
  open(route: string): Promise<void>;
}

export const windowsMethods = {
  open: 'invoke',
} satisfies Manifest<WindowsHost>;
