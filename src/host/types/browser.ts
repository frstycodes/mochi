import type { Manifest } from './manifest.ts';

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius in px for the native view, which can't follow CSS clipping. */
  radius: number;
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

/** What the page's right-click menu asks the page itself to do, at the point it was opened. */
export type BrowserMenuCommand = 'cut' | 'copy' | 'paste' | 'select-all' | 'copy-image' | 'save-image' | 'inspect';

export interface FindOptions {
  forward: boolean;
  /** True for a new or changed query; false steps to the next or previous match of the same text. */
  isNewSearch: boolean;
  matchCase: boolean;
}

/** A right-click in the page, in view CSS px; the app draws its own menu there. */
export interface BrowserContextMenu {
  x: number;
  y: number;
  linkUrl: string;
  linkText: string;
  /** The image's (or video's) source when the click was on one. */
  srcUrl: string;
  mediaType: 'none' | 'image' | 'audio' | 'video' | 'canvas' | 'file' | 'plugin';
  selectionText: string;
  isEditable: boolean;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
}

export type SearchEngine = 'duckduckgo' | 'google' | 'bing' | 'kagi';

export interface PickedElement {
  selector: string;
  html: string;
  /** PNG data URL of the element's box. */
  screenshot: string;
}

/** An agent's action on an element from its latest `snapshot` (Mochi's browser tools). */
export type BrowserAct =
  | { kind: 'click' | 'hover'; ref: string }
  | { kind: 'type'; ref: string; text: string }
  | { kind: 'select'; ref: string; value: string }
  | { kind: 'drag'; from: string; to: string }
  /** `path` is absolute; the renderer checks it's inside the thread's worktree or asks first. */
  | { kind: 'upload'; ref: string; path: string }
  | { kind: 'press'; key: string }
  | { kind: 'scroll'; ref?: string; dx: number; dy: number };

/** What browser_wait_for waits on: any one of text, selector or url, or just the time. */
export interface BrowserWait {
  text?: string;
  selector?: string;
  url?: string;
  timeoutMs: number;
}

export interface BrowserSnapshot {
  text: string;
  /** What each `[ref=eN]` in `text` is, so the renderer can tell a submit button or a password field before acting. */
  refs: Record<string, { role: string; name: string; isSubmit: boolean; isPassword: boolean }>;
}

export interface ScrollPosition {
  x: number;
  y: number;
}

/** The base branch's dev server for a before/after compare. */
export interface CompareBase {
  /** `http://localhost:<port>`; the thread page's path goes after it. */
  origin: string;
  branch: string;
  /** An already running server in the project's own checkout; Mochi didn't start it and won't stop it. */
  isReused: boolean;
}

export interface BrowserLog {
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  source: string;
  line: number;
}

export type BrowserEvent =
  | { id: string; type: 'state'; url: string; title: string; isLoading: boolean; canGoBack: boolean; canGoForward: boolean; error: string | null }
  | { id: string; type: 'console'; level: 'error' | 'warning'; message: string; source: string; line: number }
  | { id: string; type: 'open'; url: string }
  | { id: string; type: 'devtools'; mode: BrowserDevtools }
  | { id: string; type: 'frame'; data: string }
  | { id: string; type: 'found'; active: number; matches: number }
  /** App shortcuts pressed while the page has focus: the page would swallow them otherwise. */
  | { id: string; type: 'key'; key: 'find' | 'escape' }
  | ({ id: string; type: 'context-menu' } & BrowserContextMenu);

export interface BrowserHost {
  /** `spaceId` picks the persistent profile (`persist:space-<id>`): cookies and logins are isolated per space. */
  create(options: { url: string; spaceId: string }): Promise<{ id: string }>;
  destroy(id: string): Promise<void>;
  navigate(id: string, url: string): Promise<void>;
  command(id: string, command: BrowserCommand): Promise<void>;
  /** Window content coordinates in CSS px. `null` hides the view without destroying it. */
  setBounds(id: string, bounds: BrowserBounds | null): Promise<void>;
  setZoom(id: string, factor: number): Promise<void>;
  /** Hides the view at `viewport` CSS px and streams it as `frame` events (JPEG data URLs) until called with `null`. */
  mirror(id: string, viewport: { width: number; height: number } | null): Promise<void>;
  emulate(id: string, emulation: BrowserEmulation): Promise<void>;
  devtools(id: string, mode: BrowserDevtools): Promise<void>;
  /** PNG data URL of the viewport, or of the whole scrollable page. */
  capture(id: string, options: { fullPage: boolean }): Promise<string>;
  /** Resolves when the user clicks an element in the page; `null` when they press Escape or `cancelPick` runs. */
  pick(id: string): Promise<PickedElement | null>;
  cancelPick(id: string): Promise<void>;
  /** Clears a profile's cookies, logins, storage and cache (`persist:space-<spaceId>`); open pages stay open but are signed out. */
  clearData(spaceId: string): Promise<void>;
  /** The page as an accessibility-style tree with refs; replaces the refs of the previous snapshot. */
  snapshot(id: string): Promise<BrowserSnapshot>;
  /** Trusted input on a ref'd element (CDP). Resolves with a note on what happened, like the new scroll position. */
  act(id: string, act: BrowserAct): Promise<{ note?: string }>;
  /** The last console messages of every level, oldest first. */
  logs(id: string): Promise<BrowserLog[]>;
  /** Runs `script` in the page's own world (top-level await allowed): the last expression's JSON, capped at 20k chars; throws the page's error. */
  eval(id: string, script: string): Promise<{ value: string; isTruncated: boolean }>;
  waitFor(id: string, until: BrowserWait): Promise<{ isMet: boolean; waitedMs: number }>;
  /** Reloads the page when a file under `root` changes and the dev server didn't hot-reload it, keeping scroll per URL. `null` stops. */
  autoReload(id: string, root: string | null): Promise<void>;
  /** The page's scroll position, after scrolling to `to` when given. */
  scroll(id: string, to: ScrollPosition | null): Promise<ScrollPosition>;
  /** Serves `base` (default branch when unset) of the repo at `cwd` for `threadId`; resolves once its dev server listens. */
  compareStart(threadId: string, cwd: string, base?: string): Promise<CompareBase>;
  /** Stops the server and removes the temporary worktree `compareStart` made. */
  compareStop(threadId: string): Promise<void>;
  /** Highlights matches of `text` in the page; results come back as `found` events. */
  find(id: string, text: string, options: FindOptions): Promise<void>;
  stopFind(id: string): Promise<void>;
  /** Runs a context-menu command at `at` (the menu event's point); `save-image` downloads `url`. */
  menuCommand(id: string, command: BrowserMenuCommand, at: { x: number; y: number }, url?: string): Promise<void>;
  /** JPEG data URL of what the view shows now, for a stand-in while an overlay covers it. */
  peek(id: string): Promise<string>;
  /** Opens an http(s) URL in the system's default browser. */
  openExternal(url: string): Promise<void>;
  /** The default browser's name ("Arc"), or '' when the OS doesn't say. */
  defaultBrowser(): Promise<string>;
  /** Search suggestions for `query` from the engine; [] on any failure. */
  suggest(engine: SearchEngine, query: string): Promise<string[]>;
  onEvent(listener: (event: BrowserEvent) => void): () => void;
}

export const browserMethods = {
  create: 'invoke',
  destroy: 'invoke',
  navigate: 'invoke',
  command: 'invoke',
  setBounds: 'invoke',
  setZoom: 'invoke',
  mirror: 'invoke',
  emulate: 'invoke',
  devtools: 'invoke',
  capture: 'invoke',
  pick: 'invoke',
  cancelPick: 'invoke',
  clearData: 'invoke',
  snapshot: 'invoke',
  act: 'invoke',
  logs: 'invoke',
  eval: 'invoke',
  waitFor: 'invoke',
  autoReload: 'invoke',
  scroll: 'invoke',
  compareStart: 'invoke',
  compareStop: 'invoke',
  find: 'invoke',
  stopFind: 'invoke',
  menuCommand: 'invoke',
  peek: 'invoke',
  openExternal: 'invoke',
  defaultBrowser: 'invoke',
  suggest: 'invoke',
  onEvent: 'event',
} satisfies Manifest<BrowserHost>;
