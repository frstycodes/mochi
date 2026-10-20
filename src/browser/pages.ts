import { useSyncExternalStore } from 'react';
import { host } from '@/host';
import type { BrowserContextMenu, BrowserDevtools, BrowserDialog, BrowserEmulation, CompareBase } from '@/host/types/browser';
import { DEVICES, RESPONSIVE } from './devices';
import { notifyDownload } from './downloads';
import { pushHistory } from './url';

export interface ConsoleEntry {
  level: 'error' | 'warning';
  message: string;
  source: string;
  line: number;
}

/** The find bar: open while non-null. `focusAt` changes whenever ⌘F asks for the field again. */
export interface FindState {
  query: string;
  matchCase: boolean;
  active: number;
  matches: number;
  focusAt: number;
}

export type CompareState = { mode: 'split' | 'slider' } & ({ status: 'starting' } | { status: 'ready'; base: CompareBase } | { status: 'error'; message: string });

/** One browser tab's page. Lives outside React so it survives tab switches, splits and pop-outs. */
export interface Page {
  hostId: string | null;
  url: string;
  title: string;
  /** The page's own icon, from main; null until it names one. */
  favicon: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
  console: ConsoleEntry[];
  zoom: number;
  device: string;
  custom: { width: number; height: number };
  isRotated: boolean;
  dpr: number;
  touch: boolean;
  colorScheme: 'light' | 'dark' | null;
  reducedMotion: boolean;
  devtools: BrowserDevtools;
  isPicking: boolean;
  hasTakenOver: boolean;
  /** What the agent handed you the tab for (`browser_handoff`), while it waits on you; you have the tab meanwhile. */
  handoff: string | null;
  reloads: number;
  isAutoReloading: boolean;
  /** A capture waiting in the annotation editor, as a PNG data URL. */
  annotating: { image: string; name: string } | null;
  compare: CompareState | null;
  find: FindState | null;
  /** The page's right-click menu while it's open, at the point the page reported. */
  menu: BrowserContextMenu | null;
  /** The alert or confirm blocking the page; the user answers it in the native sheet. */
  dialog: BrowserDialog | null;
}

const CONSOLE_LIMIT = 50;
const HISTORY_KEY = 'harness.browser.history.v1';
const TITLES_KEY = 'harness.browser.titles.v1';

const pages = new Map<string, Page>();
const listeners = new Set<() => void>();
const byHostId = new Map<string, string>();
let tabListener: ((request: TabRequest) => void) | null = null;
let history = load<string[]>(HISTORY_KEY, []);
let titles = load<Record<string, string>>(TITLES_KEY, {});

export const pageKey = (threadId: string, tabId: string) => `${threadId}/${tabId}`;
/** The base branch's page in a before/after compare lives beside its tab's page and goes with it. */
export const basePageKey = (key: string) => `${key}~base`;
export const tabPageKey = (key: string) => key.split('~')[0];

export function usePage(key: string, url: string) {
  return useSyncExternalStore(subscribe, () => pages.get(key) ?? seed(key, url));
}

export function useAddressHistory() {
  return useSyncExternalStore(subscribe, () => history);
}

/** The title a history URL last had, for the address bar's suggestions. */
export function historyTitle(url: string) {
  return titles[url] ?? '';
}

/** Replaces the address bar's history (empty to clear it); returns what was there, for an undo. */
export function replaceAddressHistory(next: string[]) {
  const previous = history;
  history = next;
  saveHistory();
  listeners.forEach((l) => l());
  return previous;
}

export function openFind(key: string) {
  const page = pages.get(key);
  if (!page) return;
  updatePage(key, { find: { ...(page.find ?? { query: '', matchCase: false, active: 0, matches: 0 }), focusAt: Date.now() } });
}

export function closeFind(key: string) {
  const page = pages.get(key);
  if (!page?.find) return;
  if (page.hostId) void host.browser.stopFind(page.hostId);
  updatePage(key, { find: null });
}

export function getPage(key: string) {
  return pages.get(key);
}

export function updatePage(key: string, patch: Partial<Page>) {
  const page = pages.get(key);
  if (!page) return;
  pages.set(key, { ...page, ...patch });
  if (patch.url) history = pushHistory(history, patch.url);
  const url = patch.url ?? page.url;
  const isNewTitle = !!patch.title && titles[url] !== patch.title;
  if (isNewTitle) titles = { ...titles, [url]: patch.title! };
  if (patch.url || isNewTitle) saveHistory();
  listeners.forEach((l) => l());
}

export function reloadPage(key: string, hard = false) {
  const page = pages.get(key);
  if (!page) return;
  if (page.hostId) void host.browser.command(page.hostId, hard ? 'hard-reload' : 'reload');
  else updatePage(key, { reloads: page.reloads + 1 });
}

/** Native view for the page, created on first use. Desktop only. */
export async function ensureView(key: string, spaceId: string) {
  const page = pages.get(key);
  if (!host.isDesktop || !page || page.hostId || creating.has(key)) return;
  creating.add(key);
  try {
    const { id } = await host.browser.create({ url: page.url, spaceId });
    byHostId.set(id, key);
    updatePage(key, { hostId: id });
  } finally {
    creating.delete(key);
  }
}
const creating = new Set<string>();

/** The page and its native view without a mounted surface, so an agent can drive a tab while its thread is off screen. */
export function openPage(key: string, url: string, spaceId: string) {
  if (!pages.has(key)) seed(key, url);
  return ensureView(key, spaceId);
}

export function destroyPage(key: string) {
  const page = pages.get(key);
  const id = page?.hostId;
  pages.delete(key);
  if (page?.compare) {
    destroyPage(basePageKey(key));
    void host.browser.compareStop(key.split('/')[0]);
  }
  if (id) {
    byHostId.delete(id);
    void host.browser.destroy(id);
  }
  listeners.forEach((l) => l());
}

export function pageKeys() {
  return [...pages.keys()];
}

/** What a page asks of its pane: a tab for its popup (`key` is the opener's page), or closing its own tab. */
export type TabRequest = { type: 'popup'; key: string; hostId: string; url: string } | { type: 'close'; key: string };

/** `window.open` and target=_blank links open a new browser tab; a popup's `window.close()` closes it. The pane store decides where. */
export function onTabRequest(listener: (request: TabRequest) => void) {
  tabListener = listener;
  return () => void (tabListener = null);
}

/** Seeds the page at `key` with a native view main already made (a popup), so `ensureView` doesn't create another. */
export function adoptView(key: string, hostId: string, url: string) {
  byHostId.set(hostId, key);
  pages.set(key, { ...seed(key, url), hostId });
  listeners.forEach((l) => l());
}

export function emulationOf(page: Page, fit: { cssWidth: number; cssHeight: number; scale: number } | null): BrowserEmulation {
  const device = DEVICES.find((d) => d.id === page.device);
  return {
    width: fit?.cssWidth ?? 0,
    height: fit?.cssHeight ?? 0,
    // Two decimals: the pane resizing by a pixel shouldn't re-send the emulation every frame.
    scale: fit ? Math.round(fit.scale * 100) / 100 : 1,
    dpr: page.dpr || device?.dpr || 0, mobile: !!device?.mobile, touch: page.touch, colorScheme: page.colorScheme, reducedMotion: page.reducedMotion };
}

if (host.isDesktop)
  host.browser.onEvent((event) => {
    const key = byHostId.get(event.id);
    if (!key) return;
    if (event.type === 'state') {
      const { url, title, favicon, isLoading, canGoBack, canGoForward, error } = event;
      // The first load reports an empty URL until it commits.
      updatePage(key, { ...(url && { url }), title, favicon, isLoading, canGoBack, canGoForward, error });
    } else if (event.type === 'console') {
      const { level, message, source, line } = event;
      updatePage(key, { console: [...(pages.get(key)?.console ?? []), { level, message, source, line }].slice(-CONSOLE_LIMIT) });
    } else if (event.type === 'devtools') updatePage(key, { devtools: event.mode });
    else if (event.type === 'popup') tabListener?.({ type: 'popup', key, hostId: event.viewId, url: event.url });
    else if (event.type === 'closed') forgetClosed(key, event.id);
    else if (event.type === 'download') notifyDownload(event);
    else if (event.type === 'dialog') updatePage(key, { dialog: event.kind && { kind: event.kind, message: event.message } });
    else if (event.type === 'found') {
      const find = pages.get(key)?.find;
      if (find) updatePage(key, { find: { ...find, active: event.active, matches: event.matches } });
    } else if (event.type === 'key') (event.key === 'find' ? openFind : closeFind)(key);
    else if (event.type === 'context-menu') {
      const { id: _, type: __, ...menu } = event;
      updatePage(key, { menu });
    }
  });

/** The view is already gone, so the page drops its host id before the tab closes: `destroyPage` would destroy it again. */
function forgetClosed(key: string, hostId: string) {
  byHostId.delete(hostId);
  pages.delete(key);
  tabListener?.({ type: 'close', key });
}

const viewports = new Map<string, { width: number; height: number }>();

/** The CSS size the page last had on screen; the floating window shows it at that size, scaled down. */
export function rememberViewport(key: string, viewport: { width: number; height: number }) {
  viewports.set(key, viewport);
}

export function viewportOf(key: string) {
  return viewports.get(key);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function seed(key: string, url: string): Page {
  const page: Page = {
    hostId: null,
    url,
    title: '',
    favicon: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    console: [],
    zoom: 1,
    device: RESPONSIVE,
    custom: { width: 390, height: 844 },
    isRotated: false,
    dpr: 0,
    touch: false,
    colorScheme: null,
    reducedMotion: false,
    devtools: 'closed',
    isPicking: false,
    hasTakenOver: false,
    handoff: null,
    reloads: 0,
    isAutoReloading: false,
    annotating: null,
    compare: null,
    find: null,
    menu: null,
    dialog: null,
  };
  // Seeding inside a getSnapshot must return the same object every call until it changes.
  pages.set(key, page);
  return page;
}

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

/** Titles are kept only for URLs still in the history, so clearing it clears them too. */
function saveHistory() {
  titles = Object.fromEntries(history.flatMap((url) => (titles[url] ? [[url, titles[url]]] : [])));
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    localStorage.setItem(TITLES_KEY, JSON.stringify(titles));
  } catch {
    // Storage blocked (private window, artifact sandbox): history lasts for the session.
  }
}
