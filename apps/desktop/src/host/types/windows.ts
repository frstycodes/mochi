import type { AgentImage } from './agent.ts';
import type { Manifest } from '@mochi/domain/host/types/manifest';

/** macOS Screen Recording access as `systemPreferences.getMediaAccessStatus('screen')` reports it; `unsupported` off the desktop app. */
export type ScreenAccess =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'
  | 'unsupported';

export interface AppWindow {
  /** The window's id (ScreenCaptureKit window id on macOS, else a desktopCapturer source id), valid until it closes. */
  id: string;
  title: string;
  /** The owning app's name, when the OS gives one. */
  app?: string;
  /** The owning app's icon as a data URL, when the OS gives one. */
  icon?: string;
}

/** Where the macOS traffic lights sit: over the docked sidebar's header, over the hover peek's (inset with its floating panel), or hidden while the sidebar is collapsed. */
export type LightsPlacement = 'header' | 'peek' | 'hidden';

export const APPEARANCES = ['system', 'light', 'dark'] as const;
export type Appearance = (typeof APPEARANCES)[number];

export interface WindowsHost {
  /** `route` becomes the new window's location hash, e.g. `window/t1` → `#/window/t1`. A window already showing that route is focused instead. */
  open(route: string): Promise<void>;
  /** Delivers `message` to every other Mochi window (desktop) or tab (web), never back to the sender. */
  broadcast(message: unknown): Promise<void>;
  onMessage(listener: (message: unknown) => void): () => void;
  isFullScreen(): Promise<boolean>;
  onFullScreenChange(listener: (isFullScreen: boolean) => void): () => void;
  /** The page zoom (⌘+ / ⌘−). Asking also re-fits the native window buttons (traffic lights, Windows' captions) to the headers at that zoom. */
  zoomFactor(): Promise<number>;
  /** Pops the native application menu (File, Edit, View, Window) at `x`, `y` in CSS px; Windows has no menu bar to show it. */
  showAppMenu(x: number, y: number): Promise<void>;
  /** Back to 100%, like ⌘0. */
  resetZoom(): Promise<void>;
  /** Moves or hides the macOS traffic lights with the sidebar; a no-op elsewhere. */
  placeLights(placement: LightsPlacement): Promise<void>;
  /** Settings' Light / Dark / System for native chrome (menus), which otherwise follows the OS. */
  setAppearance(appearance: Appearance): Promise<void>;
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
  zoomFactor: 'invoke',
  showAppMenu: 'invoke',
  resetZoom: 'invoke',
  placeLights: 'invoke',
  setAppearance: 'invoke',
  listApps: 'invoke',
  captureApp: 'invoke',
  openScreenRecordingSettings: 'invoke',
} satisfies Manifest<WindowsHost>;
