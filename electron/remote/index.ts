import { app, BrowserWindow, safeStorage, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import sodium from 'libsodium-wrappers';
import type { ApprovalRequest, CommandResult, FollowedMachine, OtherMachine, RelayState, RemoteCommand, RemoteSettings, RemoteStatus, Scope } from '../../src/host/types/remote.ts';
import { accessToken, current as currentAccount, onAccountChange } from '../account/session.ts';
import { createWindow, mainWindow } from '../window.ts';
import { MachineCache } from './cache.ts';
import { followMachine, openLan, type MachineFollower, type Route } from './client.ts';
import { loadDeviceKeys, type DeviceKeys } from './crypto/keys.ts';
import { networkHosts } from './interfaces.ts';
import type { RawLink } from './link.ts';
import type { PairedMachine } from './registry.ts';
import { ActionLog } from './log.ts';
import { APPROVAL_TIMEOUT_MS, deviceId, pairingCode, secureAsDevice, secureAsMachine, type Origin } from './pairing.ts';
import { asKind, PROTOCOL_VERSION, type ServerFrame } from './protocol.ts';
import { Registry } from './registry.ts';
import { connectMachine, listMachines, openDeviceChannel, type MachineConnection } from './relayClient.ts';
import { startRemoteServer, type RemoteServer, type RendererBridge } from './server.ts';

// ponytail: one fixed port; a setting if it collides with something users run.
export const REMOTE_PORT = 47373;
const SNAPSHOT_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = 30_000;
const DEFAULTS: RemoteSettings = { isEnabled: false, allowsNetwork: false, machineName: '', reachesAnywhere: false };
const WELCOME_TIMEOUT_MS = 15_000;

const file = () => join(app.getPath('userData'), 'remote.json');
const log = new ActionLog();
let settings = DEFAULTS;
let server: RemoteServer | undefined;
let relay: MachineConnection | undefined;
let relayState: RelayState = { status: 'off' };
const approvals = new Map<string, (isAllowed: boolean) => void>();
// Both after `app` is ready: the key needs `safeStorage`, and userData may be overridden (MOCHI_USER_DATA) before then.
let registry: Registry | undefined;
let keys: Promise<DeviceKeys> | undefined;
const theRegistry = () => (registry ??= new Registry(app.getPath('userData')));
let cache: MachineCache | undefined;
const theCache = () => (cache ??= new MachineCache(app.getPath('userData'), safeStorage));
const theKeys = () => (keys ??= loadDeviceKeys(safeStorage, app.getPath('userData')).then((loaded) => loaded.keys));
let error: string | undefined;
let restarting: Promise<void> = Promise.resolve();
let isQuitting = false;
const snapshots = new Map<string, (snapshot: Awaited<ReturnType<RendererBridge['snapshot']>>) => void>();
const results = new Map<string, (result: CommandResult) => void>();
/** The computers this one follows as a device, by machine id. */
const followers = new Map<string, MachineFollower>();

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
  // Signing in or out starts or stops the relay connection.
  onAccountChange((account) => {
    if (settings.isEnabled && settings.reachesAnywhere) void restart();
    // Signing in opens the relay route to computers that weren't reachable; signing out ends it.
    for (const follower of followers.values()) {
      const { status, route } = follower.state();
      if (account.status === 'signed-in' ? status !== 'online' : route === 'relay') follower.resync();
    }
  });
  if (settings.isEnabled) void restart();
  app.on('will-quit', () => followers.forEach((f) => f.close()));
  syncFollowers();
}

export function remoteStatus(): RemoteStatus {
  const pairedDevices = theRegistry().devices().map(({ id, name, kind, scopes, pairedAt }) => ({ id, name, kind, scopes, pairedAt }));
  return { settings, hostName: hostname(), addresses: server?.addresses ?? [], devices: server?.devices() ?? [], pairedDevices, relay: relayState, ...(error && { error }) };
}

export async function setRemote(patch: Partial<RemoteSettings>) {
  const previous = settings;
  settings = { ...settings, ...patch };
  writeFileSync(file(), JSON.stringify(settings), { mode: 0o600 });
  if (settings.isEnabled !== previous.isEnabled || settings.allowsNetwork !== previous.allowsNetwork || settings.reachesAnywhere !== previous.reachesAnywhere) await restart();
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

export function removeDevice(id: string) {
  theRegistry().removeDevice(id);
  server?.disconnect(id);
  broadcast();
  return remoteStatus();
}

/** New scopes take effect on the device's next connection: its open ones end now, so nothing runs under the old ones. */
export function setDeviceScopes(id: string, scopes: Scope[]) {
  theRegistry().setScopes(id, scopes);
  server?.disconnect(id);
  broadcast();
  return remoteStatus();
}

export function answerApproval(id: string, isAllowed: boolean) {
  approvals.get(id)?.(isAllowed);
}

/** "Allow <name>?" in the main window, brought to front: it may be hidden while devices keep Mochi running. */
function approve(request: { name: string; code: string }): Promise<boolean> {
  const win = mainWindow();
  if (!win) return Promise.resolve(false);
  const id = randomUUID();
  const asked: ApprovalRequest = { id, name: request.name, pairingCode: request.code, expiresAt: Date.now() + APPROVAL_TIMEOUT_MS };
  win.show();
  win.focus();
  return new Promise((resolve) => {
    const timer = setTimeout(() => answer(false), APPROVAL_TIMEOUT_MS);
    function answer(isAllowed: boolean) {
      clearTimeout(timer);
      approvals.delete(id);
      resolve(isAllowed);
    }
    approvals.set(id, answer);
    win.webContents.send('remote:onApproval', asked);
  });
}

async function secure(raw: RawLink, origin: Origin) {
  const registry = theRegistry();
  const secured = await secureAsMachine(raw, origin, {
    keys: await theKeys(),
    find: (id) => registry.findDevice(id),
    approve,
    add: (device) => {
      const added = registry.addDevice(device);
      broadcast();
      return added;
    },
  });
  if ('device' in secured) registry.setDeviceKind(secured.device.deviceId, secured.device.kind);
  return secured;
}

/** Your account's other computers, from the relay, each with the code both screens show if you pair with it. */
export async function otherMachines(): Promise<OtherMachine[]> {
  const [listed, own] = await Promise.all([listMachines(await accessToken()), theKeys()]);
  await sodium.ready;
  const registry = theRegistry();
  return listed
    .filter((m) => m.id !== registry.machineId)
    .map((m) => ({
      id: m.id,
      name: m.name,
      isOnline: m.isOnline,
      isPaired: registry.machines().some((p) => p.id === m.id && p.publicKey === m.publicKey),
      kind: registry.machines().find((p) => p.id === m.id)?.kind,
      pairingCode: pairingCode(sodium.from_base64(m.publicKey, sodium.base64_variants.ORIGINAL), own.publicKey),
    }));
}

/**
 * Pairs this computer, as a device, with another of yours: through the relay, its key checked against the relay's listing
 * and, by you, the code on both screens. Resolves once that computer allowed this one and welcomed it.
 */
export async function pair(machineId: string) {
  const token = await accessToken();
  const [listed, own] = await Promise.all([listMachines(token), theKeys()]);
  const machine = listed.find((m) => m.id === machineId);
  if (!machine) throw new Error('That computer isn’t on your account anymore');
  if (!machine.isOnline) throw new Error('That computer is offline');
  await sodium.ready;
  const machineKey = sodium.from_base64(machine.publicKey, sodium.base64_variants.ORIGINAL);
  const raw = await openDeviceChannel(machineId, deviceId(own.publicKey), token);
  try {
    const link = await secureAsDevice(raw, own, machineKey, settings.machineName || hostname());
    const welcome = await new Promise<ServerFrame>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('That computer didn’t answer')), WELCOME_TIMEOUT_MS);
      link.onMessage((text) => {
        clearTimeout(timer);
        resolve(JSON.parse(text) as ServerFrame);
      });
      link.onClose(() => reject(new Error('That computer closed the connection')));
      link.send(JSON.stringify({ type: 'hello', version: PROTOCOL_VERSION }));
    });
    if (welcome.type === 'refused') throw new Error(welcome.reason);
    if (welcome.type !== 'welcome') throw new Error('That computer answered something unexpected');
    theRegistry().addMachine({ id: machine.id, name: machine.name, kind: asKind(welcome.machineKind), publicKey: machine.publicKey });
  } finally {
    raw.close(1000, 'Paired');
  }
  // A new key (paired again after a change) needs a new connection, not the old one's.
  followers.get(machineId)?.close();
  followers.delete(machineId);
  syncFollowers();
}

export function forgetMachine(machineId: string) {
  theRegistry().removeMachine(machineId);
  theCache().remove(machineId);
  syncFollowers();
}

/** The main window's latest copy of a followed machine's store, kept for the next launch and for reading it offline. */
export function cacheMachine(sender: WebContents, machineId: string, saved: string) {
  if (sender !== mainWindow()?.webContents || !followers.has(machineId)) return;
  theCache().write(machineId, saved);
}

export const cachedMachines = () => [...followers.keys()].flatMap((machineId) => {
  const saved = theCache().read(machineId);
  return saved ? [{ machineId, saved }] : [];
});

export const followedMachines = (): FollowedMachine[] => [...followers.values()].map((f) => f.state());

/** The main window's store starts its mirrors empty; every followed machine starts over with a snapshot. */
export function follow(sender: WebContents) {
  if (sender !== mainWindow()?.webContents) return;
  for (const follower of followers.values()) follower.resync();
}

export function commandMachine(machineId: string, command: RemoteCommand): Promise<CommandResult> {
  const follower = followers.get(machineId);
  return follower ? follower.command(command) : Promise.resolve({ isOk: false, error: 'This computer isn’t paired with that one' });
}

/** One follower per paired machine: new ones start, forgotten ones stop. */
function syncFollowers() {
  const machines = theRegistry().machines();
  for (const [id, follower] of followers) {
    if (machines.some((m) => m.id === id)) continue;
    follower.close();
    followers.delete(id);
  }
  for (const machine of machines) if (!followers.has(machine.id)) followers.set(machine.id, startFollowing(machine));
  broadcastMachines();

  function startFollowing(machine: PairedMachine) {
    return followMachine({
      machine: { ...machine, lastSeenAt: theCache().savedAt(machine.id) },
      routes: () => routesTo(machine.id),
      secure: async (raw) => {
        await sodium.ready;
        return secureAsDevice(raw, await theKeys(), sodium.from_base64(machine.publicKey, sodium.base64_variants.ORIGINAL), settings.machineName || hostname(), true);
      },
      onChange: broadcastMachines,
      onFrame: (frame) => mainWindow()?.webContents.send('remote:onMachineFrame', { machineId: machine.id, frame }),
      onWelcome: (welcome) => theRegistry().noteWelcome(machine.id, welcome),
    });
  }
}

/** Its LAN and Tailscale addresses as it last told this computer, then the relay. */
function routesTo(machineId: string): Route[] {
  const addresses = theRegistry().machines().find((m) => m.id === machineId)?.addresses ?? [];
  return [
    ...addresses.map((address) => ({ kind: 'lan' as const, open: () => openLan(address) })),
    {
      kind: 'relay' as const,
      open: async () => {
        const [token, own] = await Promise.all([accessToken(), theKeys()]);
        return openDeviceChannel(machineId, deviceId(own.publicKey), token);
      },
    },
  ];
}

function broadcastMachines() {
  const machines = followedMachines();
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('remote:onMachines', machines);
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
    relay?.close();
    relay = undefined;
    await server?.close();
    server = undefined;
    error = undefined;
    keepRendererAlive();
    if (!settings.isEnabled) return broadcast();
    // GAP: addresses are read once here; after joining another network, turn the setting off and on to bind the new one.
    const hosts = ['127.0.0.1', ...(settings.allowsNetwork ? networkHosts() : [])];
    try {
      server = await startRemoteServer({ hosts, port: REMOTE_PORT, secure, bridge, log, machineName: () => settings.machineName || hostname(), onDevicesChange: broadcast });
    } catch (e) {
      error = (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${REMOTE_PORT} is already in use` : String(e);
    }
    if (server && settings.reachesAnywhere && currentAccount().status === 'signed-in') await startRelay(server);
    broadcast();
  });
  return restarting;
}

async function startRelay(listening: RemoteServer) {
  await sodium.ready;
  relay = connectMachine({
    machineId: theRegistry().machineId,
    name: () => settings.machineName || hostname(),
    publicKey: sodium.to_base64((await theKeys()).publicKey, sodium.base64_variants.ORIGINAL),
    token: () => accessToken(),
    onChannel: (raw) => listening.attach(raw),
    onState: (state) => {
      relayState = state;
      broadcast();
    },
  });
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
    return { isEnabled: saved.isEnabled === true, allowsNetwork: saved.allowsNetwork === true, machineName: typeof saved.machineName === 'string' ? saved.machineName : '', reachesAnywhere: saved.reachesAnywhere === true };
  } catch {
    return DEFAULTS;
  }
}
