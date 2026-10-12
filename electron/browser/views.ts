import { BrowserWindow, session, WebContentsView, type WebContents } from 'electron';
import type { BrowserAct, BrowserBounds, BrowserCommand, BrowserDevtools, BrowserEmulation, BrowserEvent, BrowserLog, BrowserSnapshot, PickedElement } from '../../src/host/types/browser.ts';
import { CANCEL_PICK_SCRIPT, PICK_SCRIPT } from './picker.ts';
import { clickScript, focusScript, locateScript, scrollScript, SNAPSHOT_SCRIPT } from './snapshot.ts';

interface Entry {
  view: WebContentsView;
  win: BrowserWindow;
  owner: WebContents;
  bounds: BrowserBounds | null;
  zoom: number;
  devtools: WebContentsView | null;
  error: string | null;
  logs: BrowserLog[];
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

const views = new Map<string, Entry>();
const hardenedSessions = new Set<string>();
let nextId = 0;

export const isAllowedUrl = (url: string) => {
  try {
    return ['http:', 'https:', 'about:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

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
  const entry: Entry = { view, win, owner, bounds: null, zoom: 1, devtools: null, error: null, logs: [] };
  views.set(id, entry);
  view.setVisible(false);
  win.contentView.addChildView(view);
  wire(id, entry);
  win.once('closed', () => views.delete(id));
  void view.webContents.loadURL(url);
  return { id };
}

export function destroyView(owner: WebContents, id: string) {
  const entry = get(owner, id);
  views.delete(id);
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

export function setViewZoom(owner: WebContents, id: string, factor: number) {
  const entry = get(owner, id);
  entry.zoom = factor;
  entry.view.webContents.setZoomFactor(factor);
}

export async function emulateView(owner: WebContents, id: string, e: BrowserEmulation) {
  const dbg = await debuggerFor(get(owner, id).view.webContents);
  if (e.width || e.dpr || e.mobile)
    await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: e.width, height: e.height, scale: e.scale, deviceScaleFactor: e.dpr, mobile: e.mobile });
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
  const dbg = await debuggerFor(wc);
  if (act.kind === 'click') {
    // GAP: assumes CDP takes viewport CSS px times the tab's zoom; not checked on a device-emulated page.
    const { x, y, isHidden } = await run<{ x: number; y: number; isHidden: boolean }>(locateScript(act.ref));
    // A hidden page (window on another Space) gets no hit testing, so CDP's mouse events go nowhere; click in the DOM instead.
    if (isHidden) {
      await run(clickScript(act.ref));
      return { note: "Mochi's window is in the background, so this was a DOM click (event.isTrusted is false)" };
    }
    const at = { x: x * entry.zoom, y: y * entry.zoom };
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', clickCount: 1 });
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', clickCount: 1 });
    return {};
  }
  if (act.kind === 'type') {
    const { isSelect } = await run<{ isSelect: boolean }>(focusScript(act.ref, act.text));
    if (!isSelect) await dbg.sendCommand('Input.insertText', { text: act.text });
    return {};
  }
  if (act.kind === 'press') {
    await pressKey(dbg, act.key);
    return {};
  }
  const { x, y, maxY } = await run<{ x: number; y: number; maxY: number }>(scrollScript(act.ref, act.dx, act.dy));
  return { note: `Scrolled to ${x}, ${y} of ${maxY}` };
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
  wc.on('did-start-loading', () => (entry.error = null));
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
    entry.logs = [...entry.logs, { level: LOG_LEVELS.includes(level as BrowserLog['level']) ? (level as BrowserLog['level']) : 'info', message, source: sourceId, line: lineNumber }].slice(-LOG_LIMIT);
    if (level === 'error' || level === 'warning') emit({ id, type: 'console', level, message, source: sourceId, line: lineNumber });
  });
  wc.on('devtools-closed', () => {
    closeDevtools(entry);
    layout(entry);
    emit({ id, type: 'devtools', mode: 'closed' });
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) emit({ id, type: 'open', url });
    return { action: 'deny' };
  });
  const guard = (event: { preventDefault(): void }, url: string) => !isAllowedUrl(url) && event.preventDefault();
  wc.on('will-navigate', (event) => guard(event, event.url));
  wc.on('will-redirect', (event) => guard(event, event.url));
}

function layout({ view, devtools, bounds }: Entry) {
  view.setVisible(!!bounds);
  devtools?.setVisible(!!bounds);
  if (!bounds) return;
  view.setBorderRadius(Math.round(bounds.radius));
  const r = round(bounds);
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

function round(b: BrowserBounds) {
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
}
