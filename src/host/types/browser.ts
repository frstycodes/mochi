import type { Manifest } from './manifest.ts';

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserEmulation {
  /** CSS viewport; 0 × 0 keeps the view's own size. */
  width: number;
  height: number;
  /** Drawn at this scale so a device larger than the pane fits in it. */
  scale: number;
  /** 0 keeps the window's own pixel ratio. */
  dpr: number;
  mobile: boolean;
  touch: boolean;
  colorScheme: 'light' | 'dark' | null;
  reducedMotion: boolean;
}

export type BrowserCommand = 'back' | 'forward' | 'reload' | 'hard-reload' | 'stop';

export type BrowserDevtools = 'docked' | 'detached' | 'closed';

export interface PickedElement {
  selector: string;
  html: string;
  /** PNG data URL of the element's box. */
  screenshot: string;
}

export type BrowserEvent =
  | { id: string; type: 'state'; url: string; title: string; isLoading: boolean; canGoBack: boolean; canGoForward: boolean; error: string | null }
  | { id: string; type: 'console'; level: 'error' | 'warning'; message: string; source: string; line: number }
  | { id: string; type: 'open'; url: string }
  | { id: string; type: 'devtools'; mode: BrowserDevtools };

export interface BrowserHost {
  /** `spaceId` picks the persistent profile (`persist:space-<id>`): cookies and logins are isolated per space. */
  create(options: { url: string; spaceId: string }): Promise<{ id: string }>;
  destroy(id: string): Promise<void>;
  navigate(id: string, url: string): Promise<void>;
  command(id: string, command: BrowserCommand): Promise<void>;
  /** Window content coordinates in CSS px. `null` hides the view without destroying it. */
  setBounds(id: string, bounds: BrowserBounds | null): Promise<void>;
  setZoom(id: string, factor: number): Promise<void>;
  emulate(id: string, emulation: BrowserEmulation): Promise<void>;
  devtools(id: string, mode: BrowserDevtools): Promise<void>;
  /** PNG data URL of the viewport, or of the whole scrollable page. */
  capture(id: string, options: { fullPage: boolean }): Promise<string>;
  /** Resolves when the user clicks an element in the page; `null` when they press Escape or `cancelPick` runs. */
  pick(id: string): Promise<PickedElement | null>;
  cancelPick(id: string): Promise<void>;
  onEvent(listener: (event: BrowserEvent) => void): () => void;
}

export const browserMethods = {
  create: 'invoke',
  destroy: 'invoke',
  navigate: 'invoke',
  command: 'invoke',
  setBounds: 'invoke',
  setZoom: 'invoke',
  emulate: 'invoke',
  devtools: 'invoke',
  capture: 'invoke',
  pick: 'invoke',
  cancelPick: 'invoke',
  onEvent: 'event',
} satisfies Manifest<BrowserHost>;
