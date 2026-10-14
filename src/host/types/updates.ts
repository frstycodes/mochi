import type { Manifest } from './manifest.ts';

/**
 * The app's own version and its update state. `unconfigured`: this build has no update feed (MOCHI_UPDATE_URL);
 * `unsupported`: the platform can't self-update (Linux AppImage, the web build).
 */
export interface AppUpdate {
  version: string;
  status: 'unconfigured' | 'unsupported' | 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error';
  error?: string;
}

export interface UpdatesHost {
  get(): Promise<AppUpdate>;
  /** Checks the feed; a newer version downloads on its own and the state turns `ready`. */
  check(): Promise<AppUpdate>;
  /** Quits and relaunches on the downloaded version; only while `ready`. */
  install(): Promise<void>;
  onChange(callback: (update: AppUpdate) => void): () => void;
}

export const updatesMethods = {
  get: 'invoke',
  check: 'invoke',
  install: 'invoke',
  onChange: 'event',
} satisfies Manifest<UpdatesHost>;
