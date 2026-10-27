import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ReleaseChannel,
  UpdateState,
} from '@mochi/domain/host/types/updates';
import { openWindows } from '../agents/events.ts';
import {
  channelOfVersion,
  feedOf,
  nextState,
  type UpdaterEvent,
} from './state.ts';

/**
 * Mochi's own updates from GitHub Releases: checked a minute after launch and every 4 hours, downloaded on their own,
 * installed from the restart prompt or when Mochi next quits.
 */
export function startUpdates() {
  state = {
    version: app.getVersion(),
    channel: readChannel(),
    status: isSupported() ? 'idle' : 'unsupported',
  };
  if (state.status === 'unsupported') return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  applyChannel(state.channel);
  autoUpdater.on('checking-for-update', () => emit({ type: 'checking' }));
  autoUpdater.on('update-not-available', () =>
    emit({ type: 'not-available', at: Date.now() }),
  );
  autoUpdater.on('update-available', (info) =>
    emit({ type: 'available', version: info.version }),
  );
  autoUpdater.on('download-progress', (progress) =>
    emit({ type: 'progress', percent: progress.percent }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    emit({ type: 'downloaded', version: info.version, at: Date.now() }),
  );
  autoUpdater.on('error', (error) =>
    emit({ type: 'error', message: error.message, at: Date.now() }),
  );
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS).unref();
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS).unref();
}

const FIRST_CHECK_MS = 60_000;
const CHECK_EVERY_MS = 4 * 3600_000;

let state: UpdateState;

export const updateState = () => state;

export async function checkForUpdates() {
  if (state.status === 'unsupported') return state;
  // Failures arrive as the `error` event too, which is what sets the state.
  await autoUpdater.checkForUpdates().catch(() => {});
  return state;
}

export async function setChannel(channel: ReleaseChannel) {
  if (channel === state.channel) return state;
  writeFileSync(storeFile(), JSON.stringify({ channel }));
  if (state.status === 'unsupported') return (state = { ...state, channel });
  applyChannel(channel);
  emit({ type: 'channel', channel });
  return checkForUpdates();
}

export function installUpdate() {
  if (state.status === 'ready') autoUpdater.quitAndInstall();
}

function applyChannel(channel: ReleaseChannel) {
  autoUpdater.channel = feedOf(channel);
  autoUpdater.allowPrerelease = channel === 'nightly';
  // Leaving Nightly lands on the latest stable, which is usually older than the nightly that's running.
  autoUpdater.allowDowngrade = true;
}

function emit(event: UpdaterEvent) {
  state = nextState(state, event);
  for (const win of openWindows())
    win.webContents.send('updates:onChange', state);
}

// AppImage is the only Linux build electron-updater can replace in place; `APPIMAGE` is set when running from one.
const isSupported = () =>
  autoUpdater.isUpdaterActive() &&
  (process.platform !== 'linux' || !!process.env.APPIMAGE);

const storeFile = () => join(app.getPath('userData'), 'updates.json');

/** The chosen channel, or the one this build came from. */
function readChannel(): ReleaseChannel {
  try {
    const { channel } = JSON.parse(readFileSync(storeFile(), 'utf8')) as {
      channel?: unknown;
    };
    if (channel === 'stable' || channel === 'nightly') return channel;
  } catch {}
  return channelOfVersion(app.getVersion());
}
