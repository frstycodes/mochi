import { useSyncExternalStore } from 'react';
import { host } from '@/host';
import type { BrowserDevtools, BrowserEmulation } from '@/host/types/browser';
import { DEVICES, RESPONSIVE } from './devices';
import { pushHistory } from './url';

export interface ConsoleEntry {
  level: 'error' | 'warning';
  message: string;
  source: string;
  line: number;
}

/** One browser tab's page. Lives outside React so it survives tab switches, splits and pop-outs. */
export interface Page {
  hostId: string | null;
  url: string;
  title: string;
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
  reloads: number;
}

const CONSOLE_LIMIT = 50;
const HISTORY_KEY = 'harness.browser.history.v1';

const pages = new Map<string, Page>();
const listeners = new Set<() => void>();
const byHostId = new Map<string, string>();
let openListener: ((key: string, url: string) => void) | null = null;
let history = loadHistory();

export const pageKey = (threadId: string, tabId: string) => `${threadId}/${tabId}`;

export function usePage(key: string, url: string) {
  return useSyncExternalStore(subscribe, () => pages.get(key) ?? seed(key, url));
}

export function useAddressHistory() {
  return useSyncExternalStore(subscribe, () => history);
}

export function updatePage(key: string, patch: Partial<Page>) {
  const page = pages.get(key);
  if (!page) return;
  pages.set(key, { ...page, ...patch });
  if (patch.url) history = pushHistory(history, patch.url);
  if (patch.url) saveHistory(history);
  listeners.forEach((l) => l());
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

export function destroyPage(key: string) {
  const id = pages.get(key)?.hostId;
  pages.delete(key);
  if (id) {
    byHostId.delete(id);
    void host.browser.destroy(id);
  }
  listeners.forEach((l) => l());
}

export function pageKeys() {
  return [...pages.keys()];
}

/** `window.open` and target=_blank links in a page open as a new browser tab; the pane store decides where. */
export function onOpenTab(listener: (key: string, url: string) => void) {
  openListener = listener;
  return () => void (openListener = null);
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
      const { url, title, isLoading, canGoBack, canGoForward, error } = event;
      // The first load reports an empty URL until it commits.
      updatePage(key, { ...(url && { url }), title, isLoading, canGoBack, canGoForward, error });
    } else if (event.type === 'console') {
      const { level, message, source, line } = event;
      updatePage(key, { console: [...(pages.get(key)?.console ?? []), { level, message, source, line }].slice(-CONSOLE_LIMIT) });
    } else if (event.type === 'devtools') updatePage(key, { devtools: event.mode });
    else openListener?.(key, event.url);
  });

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function seed(key: string, url: string): Page {
  const page: Page = {
    hostId: null,
    url,
    title: '',
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
    reloads: 0,
  };
  // Seeding inside a getSnapshot must return the same object every call until it changes.
  pages.set(key, page);
  return page;
}

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveHistory(list: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked (private window, artifact sandbox): history lasts for the session.
  }
}
