import { app, BrowserWindow, nativeTheme, screen, shell, type Rectangle } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// DESIGN.md `background` (oklch 0.145 / 0.975) in sRGB: shown before the page paints.
const background = () => (nativeTheme.shouldUseDarkColors ? '#0a0a0d' : '#f6f6f9');

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const indexHtml = path.join(import.meta.dirname, '../dist/index.html');
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

export const isTrustedUrl = (url: string) =>
  devServerUrl ? url.startsWith(devServerUrl) : url.startsWith(`file://${indexHtml.split(path.sep).join('/')}`);

const routed = new Map<string, BrowserWindow>();

/** A torn-off window: focuses the one already showing `route`, otherwise opens it on a display with no Harness window yet, one per monitor. */
export function openRoute(route: string) {
  const existing = routed.get(route);
  if (existing && !existing.isDestroyed()) return existing.focus();
  const win = createWindow(route, freeDisplayBounds());
  routed.set(route, win);
  win.on('closed', () => routed.delete(route));
}

export function createWindow(route = '', bounds?: Rectangle) {
  const isMain = BrowserWindow.getAllWindows().length === 0;
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    ...(isMain ? savedBounds() : bounds),
    show: false,
    titleBarStyle: 'hiddenInset',
    // Centres the 12px lights on the 44px headers; their buttons start after `in-data-desktop:pl-22`.
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: background(),
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  if (isMain) win.on('close', () => writeFileSync(stateFile(), JSON.stringify(win.getNormalBounds())));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });

  const hash = route && `/${route}`;
  if (devServerUrl) void win.loadURL(hash ? `${devServerUrl}#${hash}` : devServerUrl);
  else void win.loadFile(indexHtml, { hash });
  return win;
}

nativeTheme.on('updated', () => BrowserWindow.getAllWindows().forEach((win) => win.setBackgroundColor(background())));

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
