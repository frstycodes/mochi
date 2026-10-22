import { app, BrowserWindow, Menu, nativeTheme, screen, shell, type Rectangle } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// DESIGN.md `background` (oklch 0.145 / 0.975) in sRGB: shown before the page paints.
const background = () => (nativeTheme.shouldUseDarkColors ? '#0a0a0d' : '#f6f6f9');

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
export const indexHtml = path.join(import.meta.dirname, '../dist/index.html');
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

export const isTrustedUrl = (url: string) =>
  devServerUrl ? url.startsWith(devServerUrl) : url.startsWith(pathToFileURL(indexHtml).href);

const routed = new Map<string, BrowserWindow>();

/** The window holding the app's store; torn-off windows show a single route. */
export const mainWindow = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && ![...routed.values()].includes(w));

/** A torn-off window: focuses the one already showing `route`, otherwise opens it on a display with no Mochi window yet, one per monitor. */
export function openRoute(route: string) {
  const existing = routed.get(route);
  if (existing && !existing.isDestroyed()) return existing.focus();
  const win = createWindow(route, freeDisplayBounds());
  routed.set(route, win);
  win.on('closed', () => routed.delete(route));
}

/** Brings the main window back, hidden or minimized, or opens one. */
export function showMainWindow() {
  const win = mainWindow();
  if (!win) return void createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** `isHidden`: the main window that keeps the store running for remote devices while no window is open. */
const HEADER_PX = 44;
const LIGHTS_PX = 14;

/** Centres the lights on the 44px headers, which scale with the page zoom while the lights stay native size; `--lights-end` in CSS follows. */
export function trafficLightsAt(zoom: number) {
  return { x: 16, y: Math.round((HEADER_PX * zoom - LIGHTS_PX) / 2) };
}

/** Windows' min / max / close drawn over the page's top-right corner, as tall as the 44px headers at the page zoom; symbols in DESIGN.md `foreground`. */
function captionsAt(zoom: number): Electron.TitleBarOverlay {
  return { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#f2f2f5' : '#1c1b21', height: Math.round(HEADER_PX * zoom) };
}

/** `hiddenInset` only exists on macOS: Windows gets no native title bar (and so no menu bar) through `titleBarOverlay`. Linux keeps its frame. */
const titleBar = (): Electron.BrowserWindowConstructorOptions =>
  process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: captionsAt(1) } : { titleBarStyle: 'hiddenInset', trafficLightPosition: trafficLightsAt(1) };

/** Re-fits the native window buttons to the page's current zoom and theme. */
export function fitWindowButtons(win: BrowserWindow) {
  const zoom = win.webContents.getZoomFactor();
  if (process.platform === 'darwin') win.setWindowButtonPosition(trafficLightsAt(zoom));
  if (process.platform === 'win32') win.setTitleBarOverlay(captionsAt(zoom));
}

export function createWindow(route = '', bounds?: Rectangle, isHidden = false) {
  const isMain = BrowserWindow.getAllWindows().length === 0;
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    ...(isMain ? savedBounds() : bounds),
    show: false,
    ...titleBar(),
    backgroundColor: background(),
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => !isHidden && win.show());
  win.on('enter-full-screen', () => win.webContents.send('windows:onFullScreenChange', true));
  win.on('leave-full-screen', () => win.webContents.send('windows:onFullScreenChange', false));
  if (isMain) win.on('close', () => writeFileSync(stateFile(), JSON.stringify(win.getNormalBounds())));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('context-menu', (_event, params) => showTextMenu(win, params));
  win.webContents.on('render-process-gone', (_event, { reason, exitCode }) => {
    if (reason === 'clean-exit' || win.isDestroyed()) return;
    console.error(`Window renderer gone (${reason}, exit ${exitCode}), reloading`);
    win.reload();
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });

  const hash = route && `/${route}`;
  if (devServerUrl) void win.loadURL(hash ? `${devServerUrl}#${hash}` : devServerUrl);
  else void win.loadFile(indexHtml, { hash });
  return win;
}

nativeTheme.on('updated', () =>
  BrowserWindow.getAllWindows().forEach((win) => {
    win.setBackgroundColor(background());
    fitWindowButtons(win);
  }),
);

// Electron shows no context menu by default. The app's own menus preventDefault, so this only fires where none exists:
// text fields and selected text get the native edit menu, everything else stays without one.
function showTextMenu(win: BrowserWindow, params: Electron.ContextMenuParams) {
  if (params.isEditable) {
    const spelling = params.dictionarySuggestions.map((word) => ({ label: word, click: () => win.webContents.replaceMisspelling(word) }));
    const template: Electron.MenuItemConstructorOptions[] = [
      ...spelling,
      ...(spelling.length ? [{ type: 'separator' as const }] : []),
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ];
    return Menu.buildFromTemplate(template).popup({ window: win });
  }
  if (params.selectionText.trim()) Menu.buildFromTemplate([{ role: 'copy' }]).popup({ window: win });
}

/** Every display already holding a window is taken; with none free the window opens where Electron cascades it. */
function freeDisplayBounds(): Rectangle | undefined {
  const taken = new Set(BrowserWindow.getAllWindows().map((w) => screen.getDisplayMatching(w.getBounds()).id));
  const free = screen.getAllDisplays().find((d) => !taken.has(d.id));
  if (!free) return undefined;
  const { x, y, width, height } = free.workArea;
  const w = Math.min(1280, width);
  const h = Math.min(820, height);
  return { x: x + Math.round((width - w) / 2), y: y + Math.round((height - h) / 2), width: w, height: h };
}

function savedBounds(): Rectangle | undefined {
  try {
    const bounds = JSON.parse(readFileSync(stateFile(), 'utf8')) as Rectangle;
    // A display that was unplugged since last run would leave the window off-screen.
    const { workArea } = screen.getDisplayMatching(bounds);
    const visible = bounds.x < workArea.x + workArea.width && bounds.x + bounds.width > workArea.x && bounds.y < workArea.y + workArea.height && bounds.y + bounds.height > workArea.y;
    return visible ? bounds : undefined;
  } catch {
    return undefined;
  }
}
