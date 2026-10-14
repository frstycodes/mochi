import { app, autoUpdater } from 'electron';
import type { AppUpdate } from '../../src/host/types/updates.ts';
import { openWindows } from '../agents/events.ts';

// Squirrel's feed: on macOS a URL answering with `{ "url": "<zip>" }` (or 204 when current), on Windows a folder with RELEASES.
const FEED = process.env.MOCHI_UPDATE_URL;

let state: Omit<AppUpdate, 'version'> = { status: !FEED ? 'unconfigured' : process.platform === 'linux' ? 'unsupported' : 'idle' };
let isWired = false;

export const current = (): AppUpdate => ({ version: app.getVersion(), ...state });

export async function check() {
  if (state.status === 'unconfigured' || state.status === 'unsupported' || state.status === 'ready') return current();
  wire();
  set({ status: 'checking' });
  autoUpdater.checkForUpdates();
  return current();
}

export async function install() {
  if (state.status !== 'ready') throw new Error('No update is ready to install');
  autoUpdater.quitAndInstall();
}

/** Listeners and the feed are set on first check, so a build without a feed never touches Squirrel. */
function wire() {
  if (isWired) return;
  isWired = true;
  autoUpdater.setFeedURL({ url: `${FEED}/${process.platform}/${process.arch}/${app.getVersion()}` });
  autoUpdater.on('update-available', () => set({ status: 'downloading' }));
  autoUpdater.on('update-not-available', () => set({ status: 'up-to-date' }));
  autoUpdater.on('update-downloaded', () => set({ status: 'ready' }));
  autoUpdater.on('error', (error) => set({ status: 'error', error: error.message }));
}

function set(next: Omit<AppUpdate, 'version'>) {
  state = next;
  for (const win of openWindows()) win.webContents.send('updates:onChange', current());
}
