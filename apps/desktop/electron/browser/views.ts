import {
  BrowserWindow,
  screen,
  session,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type WebContents,
} from 'electron';
import type { Locator, Page } from 'playwright-core';
import type {
  BrowserAct,
  BrowserWait,
  BrowserBounds,
  BrowserCommand,
  BrowserDevtools,
  BrowserDialog,
  BrowserEmulation,
  BrowserEvent,
  BrowserLog,
  BrowserMenuCommand,
  BrowserSnapshot,
  FindOptions,
  PickedElement,
} from '@mochi/domain/host/types/browser';
import { dialogNote } from '../../src/browser/dialog.ts';
import { CANCEL_PICK_SCRIPT, PICK_SCRIPT } from './picker.ts';
import {
  evalResult,
  EVAL_TIMEOUT_MS,
  withTimeout,
  type CdpEvaluate,
} from '@mochi/core/browser/evaluate';
import { canNavigate, isAllowedUrl } from '@mochi/core/browser/navigation';
import {
  ACTION_TIMEOUT_MS,
  locate,
  rethrowForAgent,
  runAct,
  snapshotPage,
  waitOnPage,
} from '@mochi/core/browser/drive';
import { downloadsSince, trackDownloads } from './downloads.ts';
import {
  debuggerFor,
  dropPage,
  pageFor,
  type Automated,
} from './playwright.ts';
import {
  HMR_GRACE_MS,
  isHmrLog,
  READ_SCROLL_SCRIPT,
  restoreScrollScript,
  ScrollMemory,
  watchTree,
  type ScrollPos,
} from './reload.ts';

interface Entry extends Automated {
  win: BrowserWindow;
  owner: WebContents;
  bounds: BrowserBounds | null;
  mirror: Mirror | null;
  emulation: BrowserEmulation | null;
  zoom: number;
  devtools: WebContentsView | null;
  error: string | null;
  logs: BrowserLog[];
  stopAutoReload: (() => void) | null;
  scroll: ScrollMemory;
  /** Epoch ms of the last main-frame load start and the last HMR log, to tell whether the dev server handled a change itself. */
  loadedAt: number;
  hmrAt: number;
  /** Escape in the page closes the find bar only while a search is open. */
  isFinding: boolean;
  /** Counts snapshots; an agent ref carries the one it came from. */
  snapshotGeneration: number;
  dialog: BrowserDialog | null;
  /** The page's own icon (http(s) or data URL), for its tab; dropped when the main frame navigates until the new page names one. */
  favicon: string | null;
}

interface Mirror {
  width: number;
  height: number;
  timer: NodeJS.Timeout | null;
  delay: number;
  /** The last frame sent; an identical capture isn't sent again. */
  last: string | null;
  /** Set while the window is hidden or minimized; its 'show' or 'restore' resumes the mirror. */
  isPaused: boolean;
}

const DEVTOOLS_SHARE = 0.45;
// net::ERR_ABORTED: a navigation replaced by another one, not a failure.
const ERR_ABORTED = -3;
// Isolated world for the picker so the page can't see or tamper with it.
const PICK_WORLD = 1001;
// Scroll restore and the agent's scroll reads run in their own isolated world, apart from the picker's.
const AGENT_WORLD = 1002;
const LOG_LIMIT = 200;
const LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const;
// Chromium refuses captures taller than this.
const MAX_CAPTURE_HEIGHT = 16384;
// The floating window is at most ~480 CSS px wide, so frames past 2x that are wasted bytes.
const MIRROR_MAX_WIDTH = 960;
// The mirror captures every 100 ms while the page changes, backing off to 800 ms while it doesn't; a page state change or an
// agent action brings it back to 100 ms.
const MIRROR_INTERVAL_MS = 100;
const MIRROR_IDLE_MS = 800;
const MIRROR_QUALITY = 70;

const views = new Map<string, Entry>();
const hardenedSessions = new Set<string>();
let nextId = 0;

export function createView(owner: WebContents, url: string, spaceId: string) {
  const win = BrowserWindow.fromWebContents(owner);
  if (!win) throw new Error('browser.create: no window for sender');
  const partition = `persist:space-${spaceId}`;
  harden(partition);
  // No preload: the page gets no bridge at all, and is sandboxed like a normal Chrome tab.
  const view = new WebContentsView({
    webPreferences: { partition, ...PAGE_PREFERENCES },
  });
  const id = register(view, owner, win);
  void view.webContents.loadURL(url);
  return { id };
}

// Electron focuses a view on every navigation, hidden or not: an agent's `browser_open` or a reload on a file change took the keyboard
// from the composer mid-sentence.
const PAGE_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
  focusOnNavigation: false,
};

function register(
  view: WebContentsView,
  owner: WebContents,
  win: BrowserWindow,
) {
  const id = `view-${++nextId}`;
  const entry: Entry = {
    view,
    win,
    owner,
    bounds: null,
    mirror: null,
    emulation: null,
    zoom: 1,
    devtools: null,
    error: null,
    logs: [],
    stopAutoReload: null,
    scroll: new ScrollMemory(),
    loadedAt: 0,
    hmrAt: 0,
    isFinding: false,
    automation: null,
    snapshotGeneration: 0,
    dialog: null,
    favicon: null,
  };
  views.set(id, entry);
  view.setVisible(false);
  win.contentView.addChildView(view);
  wire(id, entry);
  resumeMirrorsOn(win);
  win.once('closed', () => {
    entry.stopAutoReload?.();
    dropPage(entry);
    views.delete(id);
  });
  // The page closed itself (a popup's window.close()); destroyView and the window closing unregister first.
  view.webContents.once('destroyed', () => {
    if (views.get(id) !== entry) return;
    unregister(id, entry);
    if (!owner.isDestroyed())
      owner.send('browser:onEvent', {
        id,
        type: 'closed',
      } satisfies BrowserEvent);
  });
  return id;
}

/**
 * A page's `window.open` as a tab of its own that keeps `window.opener`, so sign-in popups can post back. The popup shares the
 * opener's session (Chromium created its webContents there), owner and window.
 */
function openPopup(
  openerId: string,
  opener: Entry,
  url: string,
  options: BrowserWindowConstructorOptions,
) {
  // `options` inherits the opener's preferences and the page's features string; ours win (getLastWebPreferences, Electron 44).
  const view = new WebContentsView({
    ...options,
    webPreferences: { ...options.webPreferences, ...PAGE_PREFERENCES },
  });
  const viewId = register(view, opener.owner, opener.win);
  if (!opener.owner.isDestroyed())
    opener.owner.send('browser:onEvent', {
      id: openerId,
      type: 'popup',
      viewId,
      url,
    } satisfies BrowserEvent);
  return view.webContents;
}

export function destroyView(owner: WebContents, id: string) {
  const entry = get(owner, id);
  unregister(id, entry);
  entry.view.webContents.close();
}

function unregister(id: string, entry: Entry) {
  stopMirror(entry);
  views.delete(id);
  entry.stopAutoReload?.();
  dropPage(entry);
  closeDevtools(entry);
  if (!entry.win.isDestroyed())
    entry.win.contentView.removeChildView(entry.view);
}

export function navigateView(owner: WebContents, id: string, url: string) {
  void get(owner, id).view.webContents.loadURL(url);
}

export function runCommand(
  owner: WebContents,
  id: string,
  command: BrowserCommand,
) {
  const wc = get(owner, id).view.webContents;
  if (command === 'back') wc.navigationHistory.goBack();
  else if (command === 'forward') wc.navigationHistory.goForward();
  else if (command === 'reload') wc.reload();
  else if (command === 'hard-reload') wc.reloadIgnoringCache();
  else wc.stop();
}

export function setViewBounds(
  owner: WebContents,
  id: string,
  bounds: BrowserBounds | null,
) {
  // A popup that closed itself is gone before its tab unmounts and hides it.
  if (!views.has(id)) return;
  const entry = get(owner, id);
  entry.bounds = bounds;
  layout(entry);
}

/** The page hidden at `viewport` and sent as frames: the floating window draws it in the DOM, scaled down, with controls over it. */
export async function setViewMirror(
  owner: WebContents,
  id: string,
  viewport: { width: number; height: number } | null,
) {
  const entry = get(owner, id);
  stopMirror(entry);
  entry.mirror = viewport && {
    ...viewport,
    timer: null,
    delay: MIRROR_INTERVAL_MS,
    last: null,
    isPaused: false,
  };
  layout(entry);
  const e = entry.emulation;
  const dbg = await debuggerFor(entry.view.webContents);
  if (!entry.mirror)
    return e
      ? applyEmulation(entry, e)
      : void (await dbg.sendCommand('Emulation.clearDeviceMetricsOverride'));
  // A hidden view lays out at 0 × 0, so the viewport is emulated; the page's own pixel ratio and mobile mode carry over.
  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: Math.round(viewport!.width),
    height: Math.round(viewport!.height),
    deviceScaleFactor: e?.dpr ?? 0,
    mobile: !!e?.mobile,
  });
  void sendFrame(id, entry);
}

async function sendFrame(id: string, entry: Entry) {
  const mirror = entry.mirror;
  if (
    !mirror ||
    entry.owner.isDestroyed() ||
    entry.view.webContents.isDestroyed()
  )
    return;
  mirror.timer = null;
  if (!entry.win.isVisible() || entry.win.isMinimized())
    return void (mirror.isPaused = true);
  const dbg = await debuggerFor(entry.view.webContents);
  // CDP, not capturePage: the view is hidden, and CDP renders it anyway. Screencast sends no frames for a hidden view.
  const scale = Math.min(
    1,
    MIRROR_MAX_WIDTH /
      (mirror.width *
        screen.getDisplayMatching(entry.win.getBounds()).scaleFactor),
  );
  const shot = await (async () => {
    // The clip is in document coordinates, so it follows the scroll position to stay on the viewport.
    const { cssVisualViewport: v } = (await dbg.sendCommand(
      'Page.getLayoutMetrics',
    )) as {
      cssVisualViewport: {
        pageX: number;
        pageY: number;
        clientWidth: number;
        clientHeight: number;
      };
    };
    const clip = {
      x: v.pageX,
      y: v.pageY,
      width: v.clientWidth,
      height: v.clientHeight,
      scale,
    };
    return (await dbg.sendCommand('Page.captureScreenshot', {
      format: 'jpeg',
      quality: MIRROR_QUALITY,
      clip,
    })) as { data: string };
  })().catch(() => null);
  if (entry.mirror !== mirror) return;
  const isChanged = !!shot && shot.data !== mirror.last;
  if (isChanged && !entry.owner.isDestroyed())
    entry.owner.send('browser:onEvent', {
      id,
      type: 'frame',
      data: `data:image/jpeg;base64,${shot.data}`,
    } satisfies BrowserEvent);
  if (isChanged) mirror.last = shot.data;
  mirror.delay = isChanged
    ? MIRROR_INTERVAL_MS
    : Math.min(mirror.delay * 2, MIRROR_IDLE_MS);
  mirror.timer = setTimeout(() => void sendFrame(id, entry), mirror.delay);
}

/** Back to full rate, capturing now unless a capture is already under way. */
function kickMirror(id: string, entry: Entry) {
  const mirror = entry.mirror;
  if (!mirror) return;
  mirror.delay = MIRROR_INTERVAL_MS;
  if (!mirror.timer && !mirror.isPaused) return;
  clearTimeout(mirror.timer ?? undefined);
  mirror.isPaused = false;
  void sendFrame(id, entry);
}

const resumable = new WeakSet<BrowserWindow>();

function resumeMirrorsOn(win: BrowserWindow) {
  if (resumable.has(win)) return;
  resumable.add(win);
  const resume = () => {
    for (const [id, entry] of views)
      if (entry.win === win && entry.mirror?.isPaused) kickMirror(id, entry);
  };
  win.on('show', resume);
  win.on('restore', resume);
}

function stopMirror(entry: Entry) {
  if (entry.mirror?.timer) clearTimeout(entry.mirror.timer);
  entry.mirror = null;
}

/**
 * Watches `root` (the thread's worktree) and reloads the page when a file changes and the dev server didn't hot-reload or reload
 * it within the grace period; every load of the same URL gets its scroll position back. `null` stops.
 */
export function setAutoReload(
  owner: WebContents,
  id: string,
  root: string | null,
) {
  const entry = get(owner, id);
  entry.stopAutoReload?.();
  entry.stopAutoReload = null;
  if (!root) return;
  const wc = entry.view.webContents;
  let isOn = true;
  const remember = ({
    isMainFrame,
    isSameDocument,
  }: {
    isMainFrame: boolean;
    isSameDocument: boolean;
  }) => isMainFrame && !isSameDocument && rememberScroll(entry);
  wc.on('did-start-navigation', remember);
  const stopWatch = watchTree(root, (since) =>
    setTimeout(() => {
      if (
        isOn &&
        !wc.isDestroyed() &&
        entry.loadedAt < since &&
        entry.hmrAt < since
      )
        wc.reload();
    }, HMR_GRACE_MS),
  );
  entry.stopAutoReload = () => {
    isOn = false;
    wc.off('did-start-navigation', remember);
    stopWatch();
  };
}

/**
 * The outgoing page's scroll position, read as its navigation starts: the page stays until the new one commits. Raw CDP, since
 * executeJavaScript waits for the new page to load and reads that. The command must go out synchronously inside the
 * 'did-start-navigation' listener (the debugger is attached since `wire`): sent a tick later, it was held and answered by the new
 * page. A commit that wins the race fails the read, and the load gets only Chromium's own restore.
 */
function rememberScroll(entry: Entry) {
  const wc = entry.view.webContents;
  const url = wc.getURL();
  const read = wc.debugger.sendCommand('Runtime.evaluate', {
    expression: READ_SCROLL_SCRIPT,
    returnByValue: true,
  }) as Promise<{ result: { value?: ScrollPos } }>;
  read
    .then(
      ({ result }) => result.value && entry.scroll.remember(url, result.value),
    )
    .catch(() => {});
}

/** Reads the page's scroll position, after moving it to `to` when given. */
export async function scrollView(
  owner: WebContents,
  id: string,
  to: ScrollPos | null,
): Promise<ScrollPos> {
  const wc = get(owner, id).view.webContents;
  const code = to
    ? `(scrollTo(${to.x}, ${to.y}), ${READ_SCROLL_SCRIPT})`
    : READ_SCROLL_SCRIPT;
  return (await wc.executeJavaScriptInIsolatedWorld(AGENT_WORLD, [
    { code },
  ])) as ScrollPos;
}

export function setViewZoom(owner: WebContents, id: string, factor: number) {
  const entry = get(owner, id);
  entry.zoom = factor;
  entry.view.webContents.setZoomFactor(factor);
}

export async function emulateView(
  owner: WebContents,
  id: string,
  e: BrowserEmulation,
) {
  const entry = get(owner, id);
  entry.emulation = e;
  if (!entry.mirror) await applyEmulation(entry, e);
}

async function applyEmulation(entry: Entry, e: BrowserEmulation) {
  const dbg = await debuggerFor(entry.view.webContents);
  // dontSetVisibleSize: otherwise Chromium grows the view to width × height and draws the scaled page in its top-left corner.
  if (e.width || e.dpr || e.mobile)
    await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: e.width,
      height: e.height,
      scale: e.scale,
      deviceScaleFactor: e.dpr,
      mobile: e.mobile,
      dontSetVisibleSize: true,
    });
  else await dbg.sendCommand('Emulation.clearDeviceMetricsOverride');
  await dbg.sendCommand('Emulation.setTouchEmulationEnabled', {
    enabled: e.touch,
    maxTouchPoints: 5,
  });
  await dbg.sendCommand('Emulation.setEmitTouchEventsForMouse', {
    enabled: e.touch,
    configuration: e.mobile ? 'mobile' : 'desktop',
  });
  await dbg.sendCommand('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: e.colorScheme ?? '' },
      {
        name: 'prefers-reduced-motion',
        value: e.reducedMotion ? 'reduce' : '',
      },
    ],
  });
}

export function setDevtools(
  owner: WebContents,
  id: string,
  mode: BrowserDevtools,
) {
  const entry = get(owner, id);
  const wc = entry.view.webContents;
  closeDevtools(entry);
  if (wc.isDevToolsOpened()) wc.closeDevTools();
  if (mode === 'detached') wc.openDevTools({ mode: 'detach' });
  if (mode === 'docked') {
    // WebContentsView has no built-in dock, so DevTools render into a sibling view below the page.
    const devtools = new WebContentsView();
    entry.devtools = devtools;
    entry.win.contentView.addChildView(devtools);
    wc.setDevToolsWebContents(devtools.webContents);
    wc.openDevTools();
  }
  layout(entry);
}

export async function captureView(
  owner: WebContents,
  id: string,
  fullPage: boolean,
) {
  const wc = get(owner, id).view.webContents;
  const dbg = await debuggerFor(wc);
  if (!fullPage) {
    // A window on another Space or behind others doesn't paint: capturePage comes back empty or throws UnknownVizError, while CDP renders it anyway.
    const image = await wc.capturePage().catch(() => null);
    if (image && !image.isEmpty()) return image.toDataURL();
    const { data } = (await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
    })) as { data: string };
    return `data:image/png;base64,${data}`;
  }
  const { cssContentSize } = (await dbg.sendCommand(
    'Page.getLayoutMetrics',
  )) as { cssContentSize: { width: number; height: number } };
  const clip = {
    x: 0,
    y: 0,
    width: cssContentSize.width,
    height: Math.min(cssContentSize.height, MAX_CAPTURE_HEIGHT),
    scale: 1,
  };
  const { data } = (await dbg.sendCommand('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip,
  })) as { data: string };
  return `data:image/png;base64,${data}`;
}

const PEEK_QUALITY = 85;

export async function peekView(owner: WebContents, id: string) {
  const wc = get(owner, id).view.webContents;
  // capturePage is the cheap path while the view is on screen; once hidden it comes back empty and CDP renders it instead.
  const image = await wc.capturePage().catch(() => null);
  if (image && !image.isEmpty())
    return `data:image/jpeg;base64,${image.toJPEG(PEEK_QUALITY).toString('base64')}`;
  const dbg = await debuggerFor(wc);
  const { data } = (await dbg.sendCommand('Page.captureScreenshot', {
    format: 'jpeg',
    quality: PEEK_QUALITY,
  })) as { data: string };
  return `data:image/jpeg;base64,${data}`;
}

export function findInView(
  owner: WebContents,
  id: string,
  text: string,
  o: FindOptions,
) {
  const entry = get(owner, id);
  entry.isFinding = true;
  // Electron's `findNext` means "start a new session", the opposite of Chromium's name for it.
  entry.view.webContents.findInPage(text, {
    forward: o.forward,
    findNext: o.isNewSearch,
    matchCase: o.matchCase,
  });
}

export function stopFindInView(owner: WebContents, id: string) {
  const entry = get(owner, id);
  entry.isFinding = false;
  entry.view.webContents.stopFindInPage('keepSelection');
}

export function menuCommandInView(
  owner: WebContents,
  id: string,
  command: BrowserMenuCommand,
  at: { x: number; y: number },
  url?: string,
) {
  const entry = get(owner, id);
  const wc = entry.view.webContents;
  // The app's menu took focus from the page; edits act on the page's focused element and selection.
  wc.focus();
  if (command === 'cut') wc.cut();
  else if (command === 'copy') wc.copy();
  else if (command === 'paste') wc.paste();
  else if (command === 'select-all') wc.selectAll();
  else if (command === 'copy-image') wc.copyImageAt(at.x, at.y);
  else if (command === 'save-image' && url) wc.downloadURL(url);
  else if (command === 'inspect') {
    if (!wc.isDevToolsOpened()) {
      setDevtools(owner, id, 'docked');
      if (!owner.isDestroyed())
        owner.send('browser:onEvent', {
          id,
          type: 'devtools',
          mode: 'docked',
        } satisfies BrowserEvent);
    }
    wc.inspectElement(at.x, at.y);
  }
}

export async function pickElement(
  owner: WebContents,
  id: string,
): Promise<PickedElement | null> {
  const entry = get(owner, id);
  const wc = entry.view.webContents;
  wc.focus();
  const picked = (await wc.executeJavaScriptInIsolatedWorld(
    PICK_WORLD,
    [{ code: PICK_SCRIPT }],
    true,
  )) as {
    selector: string;
    html: string;
    rect: BrowserBounds;
  } | null;
  if (!picked) return null;
  const z = entry.zoom;
  const rect = {
    x: Math.round(picked.rect.x * z),
    y: Math.round(picked.rect.y * z),
    width: Math.max(1, Math.round(picked.rect.width * z)),
    height: Math.max(1, Math.round(picked.rect.height * z)),
  };
  const screenshot = (await wc.capturePage(rect)).toDataURL();
  return { selector: picked.selector, html: picked.html, screenshot };
}

export async function cancelPick(owner: WebContents, id: string) {
  await get(owner, id).view.webContents.executeJavaScriptInIsolatedWorld(
    PICK_WORLD,
    [{ code: CANCEL_PICK_SCRIPT }],
  );
}

export async function snapshotView(
  owner: WebContents,
  id: string,
): Promise<BrowserSnapshot> {
  const entry = get(owner, id);
  return snapshotPage(await pageFor(entry), () => ++entry.snapshotGeneration);
}

/** `ref`'s value (an input's) or text, for main alone: Mochi stores a secret from the page without handing it to the agent. */
export async function readRefValue(
  owner: WebContents,
  id: string,
  ref: string,
) {
  const entry = get(owner, id);
  const target = await locate(
    await pageFor(entry),
    entry.snapshotGeneration,
    ref,
  );
  const value = await target.evaluate(
    (el) =>
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? el.value
        : (el.textContent ?? ''),
    undefined,
    { timeout: ACTION_TIMEOUT_MS },
  );
  return value.trim();
}

/**
 * What clicking `ref` (a Copy button) copies, caught in the page for main alone, like `readRefValue`: some sites (Slack's
 * configuration tokens) never put a secret in the page, only behind Copy. For the one click the async clipboard API and
 * copy events are wrapped to keep the text instead of writing it, so it never lands on the user's clipboard either.
 */
export async function copiedByRef(owner: WebContents, id: string, ref: string) {
  const entry = get(owner, id);
  const page = await pageFor(entry);
  return copiedBy(page, await locate(page, entry.snapshotGeneration, ref));
}

/** The Playwright page behind a view, for main's own scripted steps (setup recipes) on the agent's tab. */
export function pageOfView(owner: WebContents, id: string) {
  return pageFor(get(owner, id));
}

/** What clicking `target` copies, caught as `copiedByRef` describes. */
export async function copiedBy(page: Page, target: Locator) {
  await page.evaluate(catchCopy);
  try {
    await target.click({ timeout: ACTION_TIMEOUT_MS });
    for (
      const deadline = Date.now() + COPY_WAIT_MS;
      Date.now() < deadline;
      await new Promise((r) => setTimeout(r, 100))
    ) {
      const text = await page.evaluate(
        () => (window as CopyCatcher).__mochiCopied,
      );
      if (text) return text.trim();
    }
    return '';
  } finally {
    await page.evaluate(releaseCopy).catch(() => {});
  }
}

const COPY_WAIT_MS = 2000;

type CopyCatcher = Window & {
  __mochiCopied?: string;
  __mochiRelease?: () => void;
};

// Runs in the page, so it can only use what's in its own body.
function catchCopy() {
  const w = window as CopyCatcher;
  if (w.__mochiRelease) return;
  const clipboard = navigator.clipboard as Clipboard | undefined;
  const setData = Object.getOwnPropertyDescriptor(
    DataTransfer.prototype,
    'setData',
  )!;
  // A copy through a hidden field (execCommand) selects text that `getSelection` doesn't report in Chromium; cancelling
  // the event keeps it off the clipboard.
  const onCopy = (event: Event) => {
    const field = document.activeElement;
    const selected =
      field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement
        ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)
        : '';
    w.__mochiCopied ??= selected || getSelection()?.toString() || undefined;
    event.preventDefault();
  };
  if (clipboard) {
    clipboard.writeText = async (text: string) =>
      void (w.__mochiCopied = String(text));
    clipboard.write = async (items: ClipboardItems) => {
      for (const item of items)
        if (item.types.includes('text/plain'))
          w.__mochiCopied = await (await item.getType('text/plain')).text();
    };
  }
  DataTransfer.prototype.setData = function (type: string, data: string) {
    if (type === 'text/plain' || type === 'text')
      w.__mochiCopied = String(data);
  };
  addEventListener('copy', onCopy, true);
  w.__mochiCopied = undefined;
  w.__mochiRelease = () => {
    // Own properties shadowed the prototype's methods; deleting them brings those back.
    delete (clipboard as Partial<Clipboard> | undefined)?.writeText;
    delete (clipboard as Partial<Clipboard> | undefined)?.write;
    Object.defineProperty(DataTransfer.prototype, 'setData', setData);
    removeEventListener('copy', onCopy, true);
    w.__mochiCopied = undefined;
    w.__mochiRelease = undefined;
  };
}

function releaseCopy() {
  (window as CopyCatcher).__mochiRelease?.();
}

export function viewLogs(owner: WebContents, id: string) {
  return get(owner, id).logs;
}

/** Playwright's input goes through CDP, so the page gets trusted events, the same a person's input makes. */
export async function actOnView(
  owner: WebContents,
  id: string,
  act: BrowserAct,
): Promise<{ note?: string }> {
  const entry = get(owner, id);
  if (entry.dialog) throw new Error(dialogNote(entry.dialog));
  const page = await pageFor(entry);
  const startedAt = Date.now();
  const done = new AbortController();
  const result = await Promise.race([
    runAct(page, entry.snapshotGeneration, act),
    dialogOpened(entry, done.signal),
  ])
    .catch(rethrowForAgent)
    .finally(() => {
      done.abort();
      kickMirror(id, entry);
    });
  const downloaded = downloadsSince(id, startedAt).map(
    (d) => `Downloaded ${d.name} to ${d.path}`,
  );
  return downloaded.length
    ? { note: [result.note, ...downloaded].filter(Boolean).join('; ') }
    : result;
}

/** Playwright's action waits for the dialog it opened to be answered; the agent gets the dialog back as a note instead. */
function dialogOpened(entry: Entry, signal: AbortSignal) {
  const dbg = entry.view.webContents.debugger;
  return new Promise<{ note: string }>((resolve) => {
    const check = () =>
      entry.dialog && resolve({ note: dialogNote(entry.dialog) });
    dbg.on('message', check);
    signal.addEventListener('abort', () => dbg.off('message', check));
  });
}

export async function answerDialogInView(
  owner: WebContents,
  id: string,
  accept: boolean,
) {
  const entry = get(owner, id);
  if (!entry.dialog) throw new Error('No dialog is open in this tab');
  const dbg = await debuggerFor(entry.view.webContents);
  await dbg.sendCommand('Page.handleJavaScriptDialog', { accept });
}

/** The page's own world, so the script can read app state; `replMode` gives top-level await and the last expression's value. */
export async function evalInView(
  owner: WebContents,
  id: string,
  script: string,
) {
  const dbg = await debuggerFor(get(owner, id).view.webContents);
  const answer = withTimeout(
    dbg.sendCommand('Runtime.evaluate', {
      expression: script,
      replMode: true,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      timeout: EVAL_TIMEOUT_MS,
    }) as Promise<CdpEvaluate>,
  );
  return evalResult(await answer);
}

/** Resolves once the page shows `text`, matches `selector` or its URL contains `url` (any one given), or after `timeoutMs`. */
export async function waitForView(
  owner: WebContents,
  id: string,
  until: BrowserWait,
) {
  const entry = get(owner, id);
  const start = Date.now();
  const page =
    until.text || until.selector || until.url ? await pageFor(entry) : null;
  return waitOnPage(page, until, start);
}

function get(owner: WebContents, id: string) {
  const entry = views.get(id);
  if (!entry || entry.owner.id !== owner.id)
    throw new Error(`browser: unknown view ${id}`);
  return entry;
}

function wire(id: string, entry: Entry) {
  const wc = entry.view.webContents;
  const emit = (event: BrowserEvent) =>
    !entry.owner.isDestroyed() && entry.owner.send('browser:onEvent', event);
  const state = () => {
    kickMirror(id, entry);
    emit({
      id,
      type: 'state',
      url: wc.getURL(),
      title: wc.getTitle(),
      isLoading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      error: entry.error,
      favicon: entry.favicon,
    });
  };

  // Before `state` so the new load reports no stale error.
  wc.on('did-start-loading', () => {
    entry.error = null;
    entry.loadedAt = Date.now();
  });
  wc.on('did-finish-load', () => {
    const pos = entry.stopAutoReload && entry.scroll.take(wc.getURL());
    if (!pos) return;
    void wc
      .executeJavaScriptInIsolatedWorld(AGENT_WORLD, [
        { code: restoreScrollScript(pos) },
      ])
      .catch(() => {});
  });
  wc.on('did-navigate', () => (entry.favicon = null));
  wc.on('page-favicon-updated', (_event, favicons) => {
    entry.favicon = favicons.find((url) => /^(https?|data):/.test(url)) ?? null;
    state();
  });
  for (const name of [
    'did-start-loading',
    'did-stop-loading',
    'did-navigate',
    'did-navigate-in-page',
    'page-title-updated',
  ] as const)
    wc.on(name as 'did-start-loading', state);
  const closeDialog = watchDialogs(id, entry, emit);
  wc.on('render-process-gone', (_event, { reason }) => {
    entry.error =
      reason === 'crashed'
        ? 'The page crashed'
        : `The page crashed (${reason})`;
    dropPage(entry);
    closeDialog();
    state();
  });
  wc.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === ERR_ABORTED) return;
    entry.error = `${description} (${url})`;
    state();
  });
  // Chromium keeps zoom per origin, so a cross-origin navigation would drop the tab's own zoom.
  wc.on('did-navigate', () => wc.setZoomFactor(entry.zoom));
  wc.on('console-message', ({ level, message, sourceId, lineNumber }) => {
    // Electron logs its own dev-only security warnings into every page; they're not the page's.
    if (sourceId.startsWith('node:electron/')) return;
    if (isHmrLog(message)) entry.hmrAt = Date.now();
    entry.logs = [
      ...entry.logs,
      {
        level: LOG_LEVELS.includes(level as BrowserLog['level'])
          ? (level as BrowserLog['level'])
          : 'info',
        message,
        source: sourceId,
        line: lineNumber,
      },
    ].slice(-LOG_LIMIT);
    if (level === 'error' || level === 'warning')
      emit({
        id,
        type: 'console',
        level,
        message,
        source: sourceId,
        line: lineNumber,
      });
  });
  wc.on('found-in-page', (_event, r) =>
    emit({
      id,
      type: 'found',
      active: r.activeMatchOrdinal,
      matches: r.matches,
    }),
  );
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isMod =
      process.platform === 'darwin'
        ? input.meta && !input.control
        : input.control && !input.meta;
    if (
      isMod &&
      !input.alt &&
      !input.shift &&
      input.key.toLowerCase() === 'f'
    ) {
      event.preventDefault();
      emit({ id, type: 'key', key: 'find' });
    } else if (input.key === 'Escape' && entry.isFinding) {
      event.preventDefault();
      emit({ id, type: 'key', key: 'escape' });
    }
  });
  wc.on('context-menu', (_event, p) =>
    emit({
      id,
      type: 'context-menu',
      x: p.x,
      y: p.y,
      linkUrl: isAllowedUrl(p.linkURL) ? p.linkURL : '',
      linkText: p.linkText,
      srcUrl: p.srcURL,
      mediaType: p.mediaType,
      selectionText: p.selectionText,
      isEditable: p.isEditable,
      canCut: p.editFlags.canCut,
      canCopy: p.editFlags.canCopy,
      canPaste: p.editFlags.canPaste,
    }),
  );
  wc.on('devtools-closed', () => {
    closeDevtools(entry);
    layout(entry);
    emit({ id, type: 'devtools', mode: 'closed' });
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (!canNavigate(wc.getURL(), url)) return { action: 'deny' };
    return {
      action: 'allow',
      outlivesOpener: true,
      createWindow: (options) => openPopup(id, entry, url, options),
    };
  });
  const guard = (event: { preventDefault(): void }, url: string) =>
    !canNavigate(wc.getURL(), url) && event.preventDefault();
  wc.on('will-navigate', (event) => guard(event, event.url));
  wc.on('will-redirect', (event) => guard(event, event.url));
}

/** The page's alert or confirm, seen over CDP, which can also answer it. Electron shows the user its own sheet either way. */
function watchDialogs(
  id: string,
  entry: Entry,
  emit: (event: BrowserEvent) => void,
) {
  const wc = entry.view.webContents;
  // Electron opens its sheet a task after CDP reports the dialog, and answering over CDP leaves the sheet up with nothing behind
  // it. '-run-dialog' and '-cancel-dialogs' are Electron's internal events that open and abort that sheet
  // (lib/browser/api/web-contents.ts, Electron 44). This listener runs after Electron's, once the sheet is open.
  let sheet: 'none' | 'open' | 'stale' = 'none';
  const cancelSheet = () => {
    sheet = 'none';
    wc.emit('-cancel-dialogs');
  };
  (wc as NodeJS.EventEmitter).on('-run-dialog', () =>
    sheet === 'stale' ? cancelSheet() : (sheet = 'open'),
  );
  const closed = () => {
    if (!entry.dialog) return;
    entry.dialog = null;
    emit({ id, type: 'dialog', kind: null });
  };
  void debuggerFor(wc)
    .then((dbg) => dbg.sendCommand('Page.enable'))
    .catch(() => {});
  wc.debugger.on(
    'message',
    (
      _event,
      method,
      params: { type?: string; message?: string },
      sessionId,
    ) => {
      if (sessionId) return;
      if (
        method === 'Page.javascriptDialogOpening' &&
        (params.type === 'alert' || params.type === 'confirm')
      ) {
        entry.dialog = { kind: params.type, message: params.message ?? '' };
        emit({ id, type: 'dialog', ...entry.dialog });
      } else if (method === 'Page.javascriptDialogClosed') {
        if (sheet === 'open') cancelSheet();
        else if (entry.dialog) sheet = 'stale';
        closed();
      }
    },
  );
  return () => {
    sheet = 'none';
    closed();
  };
}

function layout({ view, devtools, bounds, mirror, owner }: Entry) {
  view.setVisible(!!bounds && !mirror);
  devtools?.setVisible(!!bounds && !mirror);
  if (mirror)
    return view.setBounds({
      x: 0,
      y: 0,
      width: Math.round(mirror.width),
      height: Math.round(mirror.height),
    });
  if (!bounds) return;
  // The renderer measures in CSS px; child views are placed in window DIPs, which differ by the app's ⌘+ / ⌘− zoom.
  const zoom = owner.isDestroyed() ? 1 : owner.getZoomFactor();
  view.setBorderRadius(Math.round(bounds.radius * zoom));
  const r = round(bounds, zoom);
  if (!devtools) return view.setBounds(r);
  const tools = Math.round(r.height * DEVTOOLS_SHARE);
  view.setBounds({ ...r, height: r.height - tools });
  devtools.setBounds({ ...r, y: r.y + r.height - tools, height: tools });
}

function closeDevtools(entry: Entry) {
  if (!entry.devtools) return;
  entry.win.contentView.removeChildView(entry.devtools);
  entry.devtools.webContents.close();
  entry.devtools = null;
}

export async function clearSpaceData(spaceId: string) {
  const ses = session.fromPartition(`persist:space-${spaceId}`);
  await Promise.all([
    ses.clearStorageData(),
    ses.clearCache(),
    ses.clearAuthCache(),
  ]);
}

function viewOf(wc: WebContents) {
  for (const [id, entry] of views)
    if (entry.view.webContents === wc) return { id, owner: entry.owner };
  return null;
}

function harden(partition: string) {
  if (hardenedSessions.has(partition)) return;
  hardenedSessions.add(partition);
  const ses = session.fromPartition(partition);
  trackDownloads(ses, viewOf);
  // Pages get nothing that reaches past the tab: no camera, mic, location, notifications or USB/HID prompts.
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(
      permission === 'fullscreen' || permission === 'clipboard-sanitized-write',
    ),
  );
  ses.setPermissionCheckHandler(
    (_wc, permission) =>
      permission === 'fullscreen' || permission === 'clipboard-sanitized-write',
  );
}

function round(b: BrowserBounds, zoom: number) {
  return {
    x: Math.round(b.x * zoom),
    y: Math.round(b.y * zoom),
    width: Math.round(b.width * zoom),
    height: Math.round(b.height * zoom),
  };
}
