import type { Manifest } from './manifest.ts';

/** The desktop app's saved threads: one JSON document in main's userData, shaped and parsed by the renderer (`src/store/persist.ts`). */
export interface DataHost {
  /** null when nothing was saved yet. */
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
}

export const dataMethods = {
  load: 'invoke',
  save: 'invoke',
} satisfies Manifest<DataHost>;
