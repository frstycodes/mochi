import type { Manifest } from './manifest.ts';

/** Stable follows tagged releases; Nightly follows the daily prerelease builds of main. */
export type ReleaseChannel = 'stable' | 'nightly';

/**
 * Mochi's own updates (electron-updater over GitHub Releases). Updates download on their own; one installs when you
 * restart from the prompt, or the next time Mochi quits.
 */
export interface UpdateState {
  channel: ReleaseChannel;
  /** The running build's version. */
  version: string;
  /** `unsupported`: a dev build, or a Linux install that isn't an AppImage. */
  status:
    | 'unsupported'
    | 'idle'
    | 'checking'
    | 'up-to-date'
    | 'downloading'
    | 'ready'
    | 'error';
  /** The version downloading or downloaded. */
  available?: string;
  /** 0–100 while downloading. */
  percent?: number;
  error?: string;
  /** Epoch ms of the last finished check. */
  checkedAt?: number;
}

export interface UpdatesHost {
  get(): Promise<UpdateState>;
  /** Switches the feed and checks it; moving to Stable from a newer nightly offers the latest stable as a downgrade. */
  setChannel(channel: ReleaseChannel): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  /** Quits and installs the downloaded update; does nothing unless `status` is `ready`. */
  install(): Promise<void>;
  onChange(callback: (state: UpdateState) => void): () => void;
}

export const updatesMethods = {
  get: 'invoke',
  setChannel: 'invoke',
  check: 'invoke',
  install: 'invoke',
  onChange: 'event',
} satisfies Manifest<UpdatesHost>;
