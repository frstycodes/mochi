import { app, BrowserWindow, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { CommandResult, RemoteSettings, RemoteStatus } from '../../src/host/types/remote.ts';
import { createWindow, mainWindow } from '../window.ts';
import { authenticateDevice } from './auth.ts';
import { networkHosts } from './interfaces.ts';
import { ActionLog } from './log.ts';
import { startRemoteServer, type RemoteServer, type RendererBridge } from './server.ts';

// ponytail: one fixed port; a setting if it collides with something users run.
export const REMOTE_PORT = 47373;
const SNAPSHOT_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = 30_000;
const DEFAULTS: RemoteSettings = { isEnabled: false, allowsNetwork: false, machineName: '' };

const file = () => join(app.getPath('userData'), 'remote.json');
const log = new ActionLog();
let settings = DEFAULTS;
let server: RemoteServer | undefined;
let error: string | undefined;
let restarting: Promise<void> = Promise.resolve();
let isQuitting = false;
const snapshots = new Map<string, (snapshot: Awaited<ReturnType<RendererBridge['snapshot']>>) => void>();
const results = new Map<string, (result: CommandResult) => void>();

/** Reads Settings › Devices and, when it is on, starts listening and keeps the renderer alive. */
export function startRemote() {
  settings = loadSettings();
  app.on('before-quit', () => (isQuitting = true));
  app.on('will-quit', () => void server?.close());
  // While remote is on, closing the main window hides it: the store lives in its renderer, and devices need it running.
  app.on('browser-window-created', (_event, win) => {
    win.on('close', (event) => {
      if (!settings.isEnabled || isQuitting || win !== mainWindow()) return;
      event.preventDefault();
      win.hide();
    });
    // A page's own `window.close()` skips the `close` event and destroys the window: bring a hidden one back.
    win.on('closed', () => !isQuitting && keepRendererAlive());
  });
  if (settings.isEnabled) void restart();
}

export function remoteStatus(): RemoteStatus {
  return { settings, hostName: hostname(), addresses: server?.addresses ?? [], devices: server?.devices() ?? [], ...(error && { error }) };
}

export async function setRemote(patch: Partial<RemoteSettings>) {
  const previous = settings;
  settings = { ...settings, ...patch };
  writeFileSync(file(), JSON.stringify(settings), { mode: 0o600 });
  if (settings.isEnabled !== previous.isEnabled || settings.allowsNetwork !== previous.allowsNetwork) await restart();
  else broadcast();
  return remoteStatus();
}

/** Only the main window's store streams; a torn-off window's own store is ignored. */
export function pushAction(sender: WebContents, epoch: string, seq: number, action: unknown) {
  if (sender === mainWindow()?.webContents) server?.publish(epoch, seq, action);
}

export function answerSnapshot(sender: WebContents, requestId: string, epoch: string, seq: number, saved: unknown) {
  if (sender !== mainWindow()?.webContents) return;
  snapshots.get(requestId)?.({ epoch, seq, saved: saved as Awaited<ReturnType<RendererBridge['snapshot']>>['saved'] });
  snapshots.delete(requestId);
}

export function answerCommand(sender: WebContents, id: string, result: CommandResult) {
  if (sender !== mainWindow()?.webContents) return;
  results.get(id)?.(result);
  results.delete(id);
}

const bridge: RendererBridge = {
  snapshot: () => askRenderer(snapshots, 'remote:onSnapshotRequest', randomUUID(), SNAPSHOT_TIMEOUT_MS, (id) => id),
  // Its own id for the round trip: two devices may pick the same command id.
  run: (request) => askRenderer(results, 'remote:onCommand', randomUUID(), COMMAND_TIMEOUT_MS, (id) => ({ ...request, id })).catch((e: unknown) => ({ isOk: false as const, error: e instanceof Error ? e.message : String(e) })),
};

function askRenderer<T>(pending: Map<string, (value: T) => void>, channel: string, id: string, timeoutMs: number, payload: (id: string) => unknown) {
  const win = mainWindow();
  if (!win) return Promise.reject(new Error('Mochi’s window isn’t open yet'));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Mochi didn’t answer in time'));
    }, timeoutMs);
    pending.set(id, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    win.webContents.send(channel, payload(id));
  });
}

/** Serialized: toggling quickly never leaves two servers on the port. */
function restart() {
  restarting = restarting.then(async () => {
    await server?.close();
    server = undefined;
    error = undefined;
    keepRendererAlive();
    if (!settings.isEnabled) return broadcast();
    // GAP: addresses are read once here; after joining another network, turn the setting off and on to bind the new one.
    const hosts = ['127.0.0.1', ...(settings.allowsNetwork ? networkHosts() : [])];
    try {
      server = await startRemoteServer({ hosts, port: REMOTE_PORT, authenticate: authenticateDevice, bridge, log, machineName: () => settings.machineName || hostname(), onDevicesChange: broadcast });
    } catch (e) {
      error = (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${REMOTE_PORT} is already in use` : String(e);
    }
    broadcast();
  });
  return restarting;
}

/** Remote on with no window: a hidden one runs the store. Remote off: a hidden main window closes for real. */
function keepRendererAlive() {
  const win = mainWindow();
  if (settings.isEnabled && !win) createWindow('', undefined, true);
  if (!settings.isEnabled && win && !win.isVisible()) win.close();
}

function broadcast() {
  const status = remoteStatus();
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('remote:onStatus', status);
}

function loadSettings(): RemoteSettings {
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8')) as Partial<RemoteSettings>;
    return { isEnabled: saved.isEnabled === true, allowsNetwork: saved.allowsNetwork === true, machineName: typeof saved.machineName === 'string' ? saved.machineName : '' };
  } catch {
    return DEFAULTS;
  }
}
