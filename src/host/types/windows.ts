import type { AgentImage } from './agent.ts';
import type { Manifest } from './manifest.ts';

/** macOS Screen Recording access as `systemPreferences.getMediaAccessStatus('screen')` reports it; `unsupported` off the desktop app. */
export type ScreenAccess = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown' | 'unsupported';

export interface AppWindow {
  /** The window's id (ScreenCaptureKit window id on macOS, else a desktopCapturer source id), valid until it closes. */
  id: string;
  title: string;
  /** The owning app's name, when the OS gives one. */
  app?: string;
  /** The owning app's icon as a data URL, when the OS gives one. */
  icon?: string;
}

export interface WindowsHost {
  /** `route` becomes the new window's location hash, e.g. `window/t1` → `#/window/t1`. A window already showing that route is focused instead. */
  open(route: string): Promise<void>;
  /** Delivers `message` to every other Mochi window (desktop) or tab (web), never back to the sender. */
  broadcast(message: unknown): Promise<void>;
  onMessage(listener: (message: unknown) => void): () => void;
  isFullScreen(): Promise<boolean>;
  onFullScreenChange(listener: (isFullScreen: boolean) => void): () => void;
  /** Other apps' windows on every Space (macOS) or on screen, never Mochi's own. Empty unless `access` is `granted`; asking while `not-determined` shows the OS prompt. */
  listApps(): Promise<{ access: ScreenAccess; windows: AppWindow[] }>;
  /** A JPEG of that window, or null once it has closed. */
  captureApp(id: string): Promise<AgentImage | null>;
  openScreenRecordingSettings(): Promise<void>;
}

export const windowsMethods = {
  open: 'invoke',
  broadcast: 'invoke',
  onMessage: 'event',
  isFullScreen: 'invoke',
  onFullScreenChange: 'event',
  listApps: 'invoke',
  captureApp: 'invoke',
  openScreenRecordingSettings: 'invoke',
} satisfies Manifest<WindowsHost>;
