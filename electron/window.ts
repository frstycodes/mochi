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

export function createWindow(route = '') {
  const isMain = BrowserWindow.getAllWindows().length === 0;
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    ...(isMain && savedBounds()),
    show: false,
    titleBarStyle: 'hiddenInset',
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
