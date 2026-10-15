import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { BrowserWindow, screen, session, WebContentsView, type WebContents } from 'electron';
import type { BrowserAct, BrowserWait, BrowserBounds, BrowserCommand, BrowserDevtools, BrowserEmulation, BrowserEvent, BrowserLog, BrowserMenuCommand, BrowserSnapshot, FindOptions, PickedElement } from '../../src/host/types/browser.ts';
import { CANCEL_PICK_SCRIPT, PICK_SCRIPT } from './picker.ts';
import { clickScript, focusScript, hoverScript, locateScript, markScript, scrollScript, SNAPSHOT_SCRIPT } from './snapshot.ts';
import { evalResult, EVAL_TIMEOUT_MS, withTimeout, type CdpEvaluate } from './evaluate.ts';
import { canNavigate, isAllowedUrl } from './navigation.ts';
import { HMR_GRACE_MS, isHmrLog, READ_SCROLL_SCRIPT, restoreScrollScript, ScrollMemory, watchTree, type ScrollPos } from './reload.ts';

interface Entry {
  view: WebContentsView;
  win: BrowserWindow;
  owner: WebContents;
  bounds: BrowserBounds | null;
  mirror: { width: number; height: number; timer: NodeJS.Timeout | null } | null;
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
  /** Scroll polling pauses while a restore settles, or it would record the top of the freshly loaded page. */
  holdScrollUntil: number;
  /** Escape in the page closes the find bar only while a search is open. */
  isFinding: boolean;
}

const DEVTOOLS_SHARE = 0.45;
// net::ERR_ABORTED: a navigation replaced by another one, not a failure.
const ERR_ABORTED = -3;
// Isolated world for the picker so the page can't see or tamper with it.
const PICK_WORLD = 1001;
// The agent's snapshot refs live in their own isolated world, apart from the picker's.
const AGENT_WORLD = 1002;
const LOG_LIMIT = 200;
const LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const;
// Chromium refuses captures taller than this.
const MAX_CAPTURE_HEIGHT = 16384;
// The floating window is at most ~480 CSS px wide, so frames past 2x that are wasted bytes.
const MIRROR_MAX_WIDTH = 960;
const MIRROR_INTERVAL_MS = 100;
const MIRROR_QUALITY = 70;
const SCROLL_POLL_MS = 300;
const SCROLL_HOLD_MS = 2500;

const views = new Map<string, Entry>();
const hardenedSessions = new Set<string>();
let nextId = 0;

export function createView(owner: WebContents, url: string, spaceId: string) {
  const win = BrowserWindow.fromWebContents(owner);
  if (!win) throw new Error('browser.create: no window for sender');
  const partition = `persist:space-${spaceId}`;
  harden(partition);
  const view = new WebContentsView({
    // No preload: the page gets no bridge at all, and is sandboxed like a normal Chrome tab.
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  const id = `view-${++nextId}`;
  const entry: Entry = { view, win, owner, bounds: null, mirror: null, emulation: null, zoom: 1, devtools: null, error: null, logs: [], stopAutoReload: null, scroll: new ScrollMemory(), loadedAt: 0, hmrAt: 0, holdScrollUntil: 0, isFinding: false };
  views.set(id, entry);
  view.setVisible(false);
  win.contentView.addChildView(view);
  wire(id, entry);
  win.once('closed', () => {
    entry.stopAutoReload?.();
    views.delete(id);
  });
  void view.webContents.loadURL(url);
  return { id };
}

export function destroyView(owner: WebContents, id: string) {
  const entry = get(owner, id);
  stopMirror(entry);
  views.delete(id);
  entry.stopAutoReload?.();
  closeDevtools(entry);
  entry.win.contentView.removeChildView(entry.view);
  entry.view.webContents.close();
}

export function navigateView(owner: WebContents, id: string, url: string) {
  void get(owner, id).view.webContents.loadURL(url);
}

export function runCommand(owner: WebContents, id: string, command: BrowserCommand) {
  const wc = get(owner, id).view.webContents;
  if (command === 'back') wc.navigationHistory.goBack();
  else if (command === 'forward') wc.navigationHistory.goForward();
  else if (command === 'reload') wc.reload();
  else if (command === 'hard-reload') wc.reloadIgnoringCache();
  else wc.stop();
}

export function setViewBounds(owner: WebContents, id: string, bounds: BrowserBounds | null) {
  const entry = get(owner, id);
  entry.bounds = bounds;
  layout(entry);
}

/** The page hidden at `viewport` and sent as frames: the floating window draws it in the DOM, scaled down, with controls over it. */
export async function setViewMirror(owner: WebContents, id: string, viewport: { width: number; height: number } | null) {
  const entry = get(owner, id);
  stopMirror(entry);
  entry.mirror = viewport && { ...viewport, timer: null };
  layout(entry);
  const e = entry.emulation;
  const dbg = await debuggerFor(entry.view.webContents);
  if (!entry.mirror) return e ? applyEmulation(entry, e) : void (await dbg.sendCommand('Emulation.clearDeviceMetricsOverride'));
  // A hidden view lays out at 0 × 0, so the viewport is emulated; the page's own pixel ratio and mobile mode carry over.
  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: Math.round(viewport!.width), height: Math.round(viewport!.height), deviceScaleFactor: e?.dpr ?? 0, mobile: !!e?.mobile });
  void sendFrame(id, entry);
}

async function sendFrame(id: string, entry: Entry) {
  const mirror = entry.mirror;
  if (!mirror || entry.owner.isDestroyed() || entry.view.webContents.isDestroyed()) return;
  const dbg = await debuggerFor(entry.view.webContents);
  // CDP, not capturePage: the view is hidden, and CDP renders it anyway. Screencast sends no frames for a hidden view.
  const scale = Math.min(1, MIRROR_MAX_WIDTH / (mirror.width * screen.getDisplayMatching(entry.win.getBounds()).scaleFactor));
  const shot = await (async () => {
    // The clip is in document coordinates, so it follows the scroll position to stay on the viewport.
    const { cssVisualViewport: v } = (await dbg.sendCommand('Page.getLayoutMetrics')) as { cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number } };
    const clip = { x: v.pageX, y: v.pageY, width: v.clientWidth, height: v.clientHeight, scale };
    return (await dbg.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: MIRROR_QUALITY, clip })) as { data: string };
  })().catch(() => null);
  if (entry.mirror !== mirror) return;
  if (shot && !entry.owner.isDestroyed()) entry.owner.send('browser:onEvent', { id, type: 'frame', data: `data:image/jpeg;base64,${shot.data}` } satisfies BrowserEvent);
  mirror.timer = setTimeout(() => void sendFrame(id, entry), MIRROR_INTERVAL_MS);
}

function stopMirror(entry: Entry) {
  if (entry.mirror?.timer) clearTimeout(entry.mirror.timer);
  entry.mirror = null;
}

/**
 * Watches `root` (the thread's worktree) and reloads the page when a file changes and the dev server didn't hot-reload or reload
 * it within the grace period; every load of the same URL gets its scroll position back. `null` stops.
 */
export function setAutoReload(owner: WebContents, id: string, root: string | null) {
  const entry = get(owner, id);
  entry.stopAutoReload?.();
  entry.stopAutoReload = null;
  if (!root) return;
  const wc = entry.view.webContents;
  let isOn = true;
  const poll = setInterval(() => void rememberScroll(entry), SCROLL_POLL_MS);
  const stopWatch = watchTree(root, (since) =>
    setTimeout(() => {
      if (isOn && !wc.isDestroyed() && entry.loadedAt < since && entry.hmrAt < since) wc.reload();
    }, HMR_GRACE_MS),
  );
  entry.stopAutoReload = () => {
    isOn = false;
    clearInterval(poll);
    stopWatch();
  };
}

async function rememberScroll(entry: Entry) {
  const wc = entry.view.webContents;
  if (wc.isDestroyed() || wc.isLoading() || Date.now() < entry.holdScrollUntil) return;
  const pos = (await wc.executeJavaScriptInIsolatedWorld(AGENT_WORLD, [{ code: READ_SCROLL_SCRIPT }]).catch(() => null)) as ScrollPos | null;
  if (pos) entry.scroll.remember(wc.getURL(), pos);
}

/** Reads the page's scroll position, after moving it to `to` when given. */
export async function scrollView(owner: WebContents, id: string, to: ScrollPos | null): Promise<ScrollPos> {
  const wc = get(owner, id).view.webContents;
  const code = to ? `(scrollTo(${to.x}, ${to.y}), ${READ_SCROLL_SCRIPT})` : READ_SCROLL_SCRIPT;
  return (await wc.executeJavaScriptInIsolatedWorld(AGENT_WORLD, [{ code }])) as ScrollPos;
}

export function setViewZoom(owner: WebContents, id: string, factor: number) {
  const entry = get(owner, id);
  entry.zoom = factor;
  entry.view.webContents.setZoomFactor(factor);
}

export async function emulateView(owner: WebContents, id: string, e: BrowserEmulation) {
  const entry = get(owner, id);
  entry.emulation = e;
  if (!entry.mirror) await applyEmulation(entry, e);
}

async function applyEmulation(entry: Entry, e: BrowserEmulation) {
  const dbg = await debuggerFor(entry.view.webContents);
  // dontSetVisibleSize: otherwise Chromium grows the view to width × height and draws the scaled page in its top-left corner.
  if (e.width || e.dpr || e.mobile)
    await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: e.width, height: e.height, scale: e.scale, deviceScaleFactor: e.dpr, mobile: e.mobile, dontSetVisibleSize: true });
  else await dbg.sendCommand('Emulation.clearDeviceMetricsOverride');
  await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: e.touch, maxTouchPoints: 5 });
  await dbg.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: e.touch, configuration: e.mobile ? 'mobile' : 'desktop' });
  await dbg.sendCommand('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: e.colorScheme ?? '' },
      { name: 'prefers-reduced-motion', value: e.reducedMotion ? 'reduce' : '' },
    ],
  });
}

export function setDevtools(owner: WebContents, id: string, mode: BrowserDevtools) {
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

export async function captureView(owner: WebContents, id: string, fullPage: boolean) {
  const wc = get(owner, id).view.webContents;
  const dbg = await debuggerFor(wc);
  if (!fullPage) {
    // A window on another Space or behind others doesn't paint: capturePage comes back empty or throws UnknownVizError, while CDP renders it anyway.
    const image = await wc.capturePage().catch(() => null);
    if (image && !image.isEmpty()) return image.toDataURL();
    const { data } = (await dbg.sendCommand('Page.captureScreenshot', { format: 'png' })) as { data: string };
    return `data:image/png;base64,${data}`;
  }
  const { cssContentSize } = (await dbg.sendCommand('Page.getLayoutMetrics')) as { cssContentSize: { width: number; height: number } };
  const clip = { x: 0, y: 0, width: cssContentSize.width, height: Math.min(cssContentSize.height, MAX_CAPTURE_HEIGHT), scale: 1 };
  const { data } = (await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip })) as { data: string };
  return `data:image/png;base64,${data}`;
}

const PEEK_QUALITY = 85;

export async function peekView(owner: WebContents, id: string) {
  const wc = get(owner, id).view.webContents;
  // capturePage is the cheap path while the view is on screen; once hidden it comes back empty and CDP renders it instead.
  const image = await wc.capturePage().catch(() => null);
  if (image && !image.isEmpty()) return `data:image/jpeg;base64,${image.toJPEG(PEEK_QUALITY).toString('base64')}`;
  const dbg = await debuggerFor(wc);
  const { data } = (await dbg.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: PEEK_QUALITY })) as { data: string };
  return `data:image/jpeg;base64,${data}`;
}

export function findInView(owner: WebContents, id: string, text: string, o: FindOptions) {
  const entry = get(owner, id);
  entry.isFinding = true;
  // Electron's `findNext` means "start a new session", the opposite of Chromium's name for it.
  entry.view.webContents.findInPage(text, { forward: o.forward, findNext: o.isNewSearch, matchCase: o.matchCase });
}

export function stopFindInView(owner: WebContents, id: string) {
  const entry = get(owner, id);
  entry.isFinding = false;
  entry.view.webContents.stopFindInPage('keepSelection');
}

export function menuCommandInView(owner: WebContents, id: string, command: BrowserMenuCommand, at: { x: number; y: number }, url?: string) {
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
      if (!owner.isDestroyed()) owner.send('browser:onEvent', { id, type: 'devtools', mode: 'docked' } satisfies BrowserEvent);
    }
    wc.inspectElement(at.x, at.y);
  }
}

export async function pickElement(owner: WebContents, id: string): Promise<PickedElement | null> {
  const entry = get(owner, id);
  const wc = entry.view.webContents;
  wc.focus();
  const picked = (await wc.executeJavaScriptInIsolatedWorld(PICK_WORLD, [{ code: PICK_SCRIPT }], true)) as {
    selector: string;
    html: string;
    rect: BrowserBounds;
  } | null;
  if (!picked) return null;
  const z = entry.zoom;
  const rect = { x: Math.round(picked.rect.x * z), y: Math.round(picked.rect.y * z), width: Math.max(1, Math.round(picked.rect.width * z)), height: Math.max(1, Math.round(picked.rect.height * z)) };
  const screenshot = (await wc.capturePage(rect)).toDataURL();
  return { selector: picked.selector, html: picked.html, screenshot };
}

export async function cancelPick(owner: WebContents, id: string) {
  await get(owner, id).view.webContents.executeJavaScriptInIsolatedWorld(PICK_WORLD, [{ code: CANCEL_PICK_SCRIPT }]);
}

export async function snapshotView(owner: WebContents, id: string): Promise<BrowserSnapshot> {
  return (await get(owner, id).view.webContents.executeJavaScriptInIsolatedWorld(AGENT_WORLD, [{ code: SNAPSHOT_SCRIPT }])) as BrowserSnapshot;
}

export function viewLogs(owner: WebContents, id: string) {
  return get(owner, id).logs;
}

/** Clicks and keys go through CDP so the page gets trusted events, the same a person's input makes. */
export async function actOnView(owner: WebContents, id: string, act: BrowserAct): Promise<{ note?: string }> {
  const entry = get(owner, id);
  const wc = entry.view.webContents;
  const run = async <T>(code: string) => {
    const result = (await wc.executeJavaScriptInIsolatedWorld(AGENT_WORLD, [{ code }])) as T & { error?: string };
    if (result.error) throw new Error(result.error);
    return result;
  };
  // GAP: assumes CDP takes viewport CSS px times the tab's zoom; not checked on a device-emulated page.
  const locate = async (ref: string) => {
    const { x, y, isHidden } = await run<{ x: number; y: number; isHidden: boolean }>(locateScript(ref));
    return { at: { x: x * entry.zoom, y: y * entry.zoom }, isHidden };
  };
  const dbg = await debuggerFor(wc);
  const mouse = (type: string, at: { x: number; y: number }, extra = {}) => dbg.sendCommand('Input.dispatchMouseEvent', { type, ...at, ...extra });
  switch (act.kind) {
    case 'click': {
      const { at, isHidden } = await locate(act.ref);
      // A hidden page (window on another Space) gets no hit testing, so CDP's mouse events go nowhere; click in the DOM instead.
      if (isHidden) {
        await run(clickScript(act.ref));
        return { note: HIDDEN_NOTE('click') };
      }
      await mouse('mouseMoved', at);
      await mouse('mousePressed', at, { button: 'left', clickCount: 1 });
      await mouse('mouseReleased', at, { button: 'left', clickCount: 1 });
      return {};
    }
    case 'hover': {
      const { at, isHidden } = await locate(act.ref);
      if (!isHidden) {
        await mouse('mouseMoved', at);
        return {};
      }
      await run(hoverScript(act.ref));
      return { note: `${HIDDEN_NOTE('hover')}; CSS :hover styles don't apply` };
    }
    case 'drag': {
      const from = await locate(act.from);
      const to = await locate(act.to);
      if (from.isHidden) throw new Error("Mochi's window is in the background, so the page gets no pointer input; ask the user to bring Mochi forward, then drag again");
      // GAP: mouse-event drags (sortable lists, sliders); HTML5 drag and drop through CDP's mouse events is not verified.
      await mouse('mouseMoved', from.at);
      await mouse('mousePressed', from.at, { button: 'left', clickCount: 1 });
      for (let i = 1; i <= DRAG_STEPS; i++) await mouse('mouseMoved', { x: from.at.x + ((to.at.x - from.at.x) * i) / DRAG_STEPS, y: from.at.y + ((to.at.y - from.at.y) * i) / DRAG_STEPS }, { button: 'left', buttons: 1 });
      await mouse('mouseReleased', to.at, { button: 'left', clickCount: 1 });
      return {};
    }
    case 'type': {
      const { isSelect } = await run<{ isSelect: boolean }>(focusScript(act.ref, act.text));
      if (!isSelect) await dbg.sendCommand('Input.insertText', { text: act.text });
      return {};
    }
    case 'select': {
      const { isSelect } = await run<{ isSelect: boolean }>(focusScript(act.ref, act.value));
      if (!isSelect) throw new Error('That element is not a <select>; use browser_type for a text field or browser_click for a custom dropdown');
      return {};
    }
    case 'upload': {
      if (!(await stat(act.path).then((s) => s.isFile(), () => false))) throw new Error(`No file at ${act.path}`);
      // CDP sets files by DOM node id; the ref lives in the isolated world, so it marks the element for a moment to find it.
      const mark = randomBytes(8).toString('hex');
      await run(markScript(act.ref, mark));
      const { root } = (await dbg.sendCommand('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } };
      const { nodeId } = (await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-mochi-upload="${mark}"]` })) as { nodeId: number };
      if (!nodeId) throw new Error('That element is not on the page now; take a new browser_snapshot');
      await dbg.sendCommand('DOM.removeAttribute', { nodeId, name: 'data-mochi-upload' });
      await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: [act.path] });
      return {};
    }
    case 'press':
      await pressKey(dbg, act.key);
      return {};
    case 'scroll': {
      const { x, y, maxY } = await run<{ x: number; y: number; maxY: number }>(scrollScript(act.ref, act.dx, act.dy));
      return { note: `Scrolled to ${x}, ${y} of ${maxY}` };
    }
  }
}

const DRAG_STEPS = 8;
const HIDDEN_NOTE = (what: string) => `Mochi's window is in the background, so this was a DOM ${what} (event.isTrusted is false)`;

/** The page's own world, so the script can read app state; `replMode` gives top-level await and the last expression's value. */
export async function evalInView(owner: WebContents, id: string, script: string) {
  const dbg = await debuggerFor(get(owner, id).view.webContents);
  const answer = withTimeout(dbg.sendCommand('Runtime.evaluate', { expression: script, replMode: true, awaitPromise: true, returnByValue: true, userGesture: true, timeout: EVAL_TIMEOUT_MS }) as Promise<CdpEvaluate>);
  return evalResult(await answer);
}

const WAIT_POLL_MS = 200;

/** Resolves once the page shows `text`, matches `selector` or its URL contains `url` (any one given), or after `timeoutMs`. */
export async function waitForView(owner: WebContents, id: string, until: BrowserWait) {
  const wc = get(owner, id).view.webContents;
  const check = `(() => { const want = ${JSON.stringify(until)}; return (!!want.text && !!document.body && document.body.innerText.includes(want.text)) || (!!want.selector && !!document.querySelector(want.selector)) || (!!want.url && location.href.includes(want.url)); })()`;
  const start = Date.now();
  for (;;) {
    const isMet = until.text || until.selector || until.url ? await wc.executeJavaScriptInIsolatedWorld(AGENT_WORLD, [{ code: check }]).catch(() => false) : false;
    if (isMet) return { isMet: true, waitedMs: Date.now() - start };
    if (Date.now() - start >= until.timeoutMs) return { isMet: false, waitedMs: Date.now() - start };
    await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
  }
}

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  ' ': { code: 'Space', keyCode: 32, text: ' ' },
};

async function pressKey(dbg: Electron.Debugger, name: string) {
  const key = name === 'Space' ? ' ' : name;
  const known = KEYS[key];
  if (!known && [...key].length !== 1) throw new Error(`Unknown key "${key}"; use a single character or one of ${Object.keys(KEYS).filter((k) => k !== ' ').join(', ')}, Space`);
  const { code, keyCode, text } = known ?? { code: '', keyCode: key.toUpperCase().charCodeAt(0), text: key };
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await dbg.sendCommand('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text && { text, unmodifiedText: text }) });
  await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

function get(owner: WebContents, id: string) {
  const entry = views.get(id);
  if (!entry || entry.owner.id !== owner.id) throw new Error(`browser: unknown view ${id}`);
  return entry;
}

function wire(id: string, entry: Entry) {
  const wc = entry.view.webContents;
  const emit = (event: BrowserEvent) => !entry.owner.isDestroyed() && entry.owner.send('browser:onEvent', event);
  const state = () =>
    emit({
      id,
      type: 'state',
      url: wc.getURL(),
      title: wc.getTitle(),
      isLoading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      error: entry.error,
    });

  // Before `state` so the new load reports no stale error.
  wc.on('did-start-loading', () => {
    entry.error = null;
    entry.loadedAt = Date.now();
  });
  wc.on('did-finish-load', () => {
    const pos = entry.stopAutoReload && entry.scroll.take(wc.getURL());
    if (!pos) return;
    entry.holdScrollUntil = Date.now() + SCROLL_HOLD_MS;
    void wc.executeJavaScriptInIsolatedWorld(AGENT_WORLD, [{ code: restoreScrollScript(pos) }]).catch(() => {});
  });
  for (const name of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated'] as const) wc.on(name as 'did-start-loading', state);
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
    entry.logs = [...entry.logs, { level: LOG_LEVELS.includes(level as BrowserLog['level']) ? (level as BrowserLog['level']) : 'info', message, source: sourceId, line: lineNumber }].slice(-LOG_LIMIT);
    if (level === 'error' || level === 'warning') emit({ id, type: 'console', level, message, source: sourceId, line: lineNumber });
  });
  wc.on('found-in-page', (_event, r) => emit({ id, type: 'found', active: r.activeMatchOrdinal, matches: r.matches }));
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isMod = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
    if (isMod && !input.alt && !input.shift && input.key.toLowerCase() === 'f') {
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
    if (canNavigate(wc.getURL(), url)) emit({ id, type: 'open', url });
    return { action: 'deny' };
  });
  const guard = (event: { preventDefault(): void }, url: string) => !canNavigate(wc.getURL(), url) && event.preventDefault();
  wc.on('will-navigate', (event) => guard(event, event.url));
  wc.on('will-redirect', (event) => guard(event, event.url));
}

function layout({ view, devtools, bounds, mirror, owner }: Entry) {
  view.setVisible(!!bounds && !mirror);
  devtools?.setVisible(!!bounds && !mirror);
  if (mirror) return view.setBounds({ x: 0, y: 0, width: Math.round(mirror.width), height: Math.round(mirror.height) });
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

async function debuggerFor(wc: WebContents) {
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  return wc.debugger;
}

export async function clearSpaceData(spaceId: string) {
  const ses = session.fromPartition(`persist:space-${spaceId}`);
  await Promise.all([ses.clearStorageData(), ses.clearCache(), ses.clearAuthCache()]);
}

function harden(partition: string) {
  if (hardenedSessions.has(partition)) return;
  hardenedSessions.add(partition);
  const ses = session.fromPartition(partition);
  // Pages get nothing that reaches past the tab: no camera, mic, location, notifications or USB/HID prompts.
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen' || permission === 'clipboard-sanitized-write'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen' || permission === 'clipboard-sanitized-write');
}

function round(b: BrowserBounds, zoom: number) {
  return { x: Math.round(b.x * zoom), y: Math.round(b.y * zoom), width: Math.round(b.width * zoom), height: Math.round(b.height * zoom) };
}
