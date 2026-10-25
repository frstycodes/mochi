import {
  app,
  BrowserWindow,
  powerMonitor,
  safeStorage,
  type WebContents,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join as joinPath } from 'node:path';
import sodium from 'libsodium-wrappers';
import { Option, Schema } from 'effect';
import { Persist, Relay } from '@mochi/schema';
import { deviceTunnel, logToCore } from '@mochi/core/host';
import { openLan } from '@mochi/core/remote/device';
import type { RawLink } from '@mochi/core/remote/link';
import {
  connectMachine,
  forgetMachineAtRelay,
  listMachines,
  listMembers,
  openDeviceChannel,
  publishMembers,
  type MachineConnection,
} from '@mochi/core/remote/relayClient';
import type {
  ApprovalRequest,
  CommandResult,
  FollowedMachine,
  MemberInfo,
  OtherMachine,
  RelayState,
  RemoteCommand,
  RemoteCommandRequest,
  RemoteSettings,
  RemoteStatus,
  Scope,
} from '../../src/host/types/remote.ts';
import {
  accessToken,
  current as currentAccount,
  onAccountChange,
} from '../account/session.ts';
import { isAnyBusy, onBusyChange } from '../agents/events.ts';
import { createWindow, mainWindow } from '../window.ts';
import { MachineCache } from './cache.ts';
import { followMachine, type MachineFollower, type Route } from './client.ts';
import { loadDeviceKeys, type DeviceKeys } from './crypto/keys.ts';
import { networkHosts } from './interfaces.ts';
import { holdAwake } from './keepAwake.ts';
import type { PairedMachine } from './registry.ts';
import {
  approveMember,
  mergeRecords,
  parseRecords,
  resolveMembers,
  signMember,
  signRemoval,
  vouches,
  type MemberRecord,
  type Membership,
} from './members.ts';
import {
  APPROVAL_TIMEOUT_MS,
  asKind,
  deviceId,
  pairingCode,
  secureAsDevice,
  secureAsMachine,
  THIS_KIND,
  type Origin,
} from './pairing.ts';
import { Registry } from './registry.ts';
import { startRemoteServer, type RemoteServer } from './server.ts';

// One fixed port; a setting if it collides with something users run. `MOCHI_REMOTE_PORT` lets a dev run sit beside an installed Mochi.
export const REMOTE_PORT = Number(process.env.MOCHI_REMOTE_PORT) || 47373;
const COMMAND_TIMEOUT_MS = 30_000;
const DEFAULTS: RemoteSettings = {
  isEnabled: false,
  allowsNetwork: false,
  machineName: '',
  reachesAnywhere: false,
  keepsAwake: true,
};
const WELCOME_TIMEOUT_MS = 15_000;
const decodeMachineFrame = Schema.decodeUnknownOption(
  Schema.fromJsonString(Relay.MachineLinkFrame),
);

const file = () => joinPath(app.getPath('userData'), 'remote.json');
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
const theCache = () =>
  (cache ??= new MachineCache(app.getPath('userData'), safeStorage));
const theKeys = () =>
  (keys ??= loadDeviceKeys(safeStorage, app.getPath('userData')).then(
    (loaded) => loaded.keys,
  ));
let error: string | undefined;
let restarting: Promise<void> = Promise.resolve();
let isQuitting = false;
const results = new Map<string, (result: CommandResult) => void>();
/** The computers this one follows as a device, by machine id. */
const followers = new Map<string, MachineFollower & { publicKey: string }>();
/** Who this computer trusts, from the records in `devices.json`; set by the first `absorb`. */
let membership: Membership | undefined;
let absorbing: Promise<unknown> = Promise.resolve();

/** Reads Settings › Remote access and, when it is on, starts listening and keeps the renderer alive. */
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
    if (account.status === 'signed-in') void pullMembers();
    // Signing in opens the relay route to computers that weren't reachable; signing out ends it.
    for (const follower of followers.values()) {
      const { status, route } = follower.state();
      if (
        account.status === 'signed-in' ? status !== 'online' : route === 'relay'
      )
        follower.resync();
    }
  });
  if (settings.isEnabled) void restart();
  app.on('will-quit', () => followers.forEach((f) => f.close()));
  onBusyChange(syncAwake);
  powerMonitor.on('on-battery', broadcast);
  powerMonitor.on('on-ac', broadcast);
  void absorb([]).then(pullMembers);
}

export function remoteStatus(): RemoteStatus {
  const registry = theRegistry();
  const members = registry
    .devices()
    .map(({ id, name, kind, scopes, pairedAt, publicKey }): MemberInfo => {
      const machine = registry
        .machines()
        .find((m) => m.publicKey === publicKey);
      const followed = machine && followers.get(machine.id)?.state();
      return {
        id,
        name,
        kind: followed?.kind ?? kind,
        scopes,
        addedAt: pairedAt,
        ...(followed && { machineStatus: followed.status }),
      };
    });
  return {
    settings,
    hostName: hostname(),
    addresses: server?.addresses ?? [],
    devices: server?.devices() ?? [],
    members,
    isRemoved: membership?.isRemoved ?? false,
    relay: relayState,
    isOnBattery: powerMonitor.isOnBatteryPower(),
    ...(error && { error }),
  };
}

export async function setRemote(patch: Partial<RemoteSettings>) {
  const previous = settings;
  settings = { ...settings, ...patch };
  writeFileSync(file(), JSON.stringify(settings), { mode: 0o600 });
  // Its own record carries its name: renaming signs a new one.
  if (settings.machineName !== previous.machineName) void absorb([]);
  if (
    settings.isEnabled !== previous.isEnabled ||
    settings.allowsNetwork !== previous.allowsNetwork ||
    settings.reachesAnywhere !== previous.reachesAnywhere
  )
    await restart();
  else broadcast();
  return remoteStatus();
}

export function answerCommand(
  sender: WebContents,
  id: string,
  result: CommandResult,
) {
  if (sender !== mainWindow()?.webContents) return;
  results.get(id)?.(result);
  results.delete(id);
}

/**
 * Removes a member from all your computers: a signed removal, spread like any record, ends its connections wherever it
 * arrives. It joins again only with a new approval.
 */
export async function removeMember(id: string) {
  const machineId = theRegistry()
    .machines()
    .find((m) => m.publicKey === theRegistry().findDevice(id)?.publicKey)?.id;
  await absorb([signRemoval(await theKeys(), id, Date.now())]);
  // Off the relay's list too, which closes its relay socket; it registers again if it is still running, as a stranger.
  if (machineId && currentAccount().status === 'signed-in')
    await forgetMachineAtRelay(await accessToken(), machineId).catch(() => {});
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
  const asked: ApprovalRequest = {
    id,
    name: request.name,
    pairingCode: request.code,
    expiresAt: Date.now() + APPROVAL_TIMEOUT_MS,
  };
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
    refresh: pullMembers,
    approve,
    add: async (device) => {
      await absorb([
        approveMember(
          registry.records() ?? [],
          await theKeys(),
          device,
          Date.now(),
        ),
      ]);
      return registry.findDevice(device.id);
    },
  });
  if ('device' in secured)
    registry.setDeviceKind(secured.device.deviceId, secured.device.kind);
  return secured;
}

/** Computers on your account that aren't members yet, from the relay, each with the code both screens show to join. */
export async function otherMachines(): Promise<OtherMachine[]> {
  const [listed, own] = await Promise.all([
    listMachines(await accessToken()),
    theKeys(),
    pullMembers(),
  ]);
  await sodium.ready;
  const registry = theRegistry();
  const isMember = (publicKey: string) =>
    publicKey ===
      sodium.to_base64(own.publicKey, sodium.base64_variants.ORIGINAL) ||
    registry.devices().some((d) => d.publicKey === publicKey);
  return listed
    .filter((m) => m.id !== registry.machineId && !isMember(m.publicKey))
    .map((m) => ({
      id: m.id,
      name: m.name,
      isOnline: m.isOnline,
      pairingCode: pairingCode(
        sodium.from_base64(m.publicKey, sodium.base64_variants.ORIGINAL),
        own.publicKey,
      ),
    }));
}

/**
 * Joins your computers through one of them: through the relay, its key checked against the relay's listing and, by you,
 * the code on both screens. Once it allowed this one, each vouches for the other, and every member's records reach this
 * computer, so it reaches all of them and they it with no more prompts.
 */
export async function join(machineId: string) {
  const token = await accessToken();
  const [listed, own] = await Promise.all([listMachines(token), theKeys()]);
  const machine = listed.find((m) => m.id === machineId);
  if (!machine) throw new Error('That computer isn’t on your account anymore');
  if (!machine.isOnline) throw new Error('That computer is offline');
  await sodium.ready;
  const machineKey = sodium.from_base64(
    machine.publicKey,
    sodium.base64_variants.ORIGINAL,
  );
  const raw = await openDeviceChannel(
    machineId,
    deviceId(own.publicKey),
    token,
  );
  try {
    const link = await secureAsDevice(
      raw,
      own,
      machineKey,
      settings.machineName || hostname(),
    );
    const welcome = await new Promise<Relay.MachineLinkFrame | undefined>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('That computer didn’t answer')),
          WELCOME_TIMEOUT_MS,
        );
        link.onMessage((text) => {
          clearTimeout(timer);
          resolve(Option.getOrUndefined(decodeMachineFrame(text)));
        });
        link.onClose(() =>
          reject(new Error('That computer closed the connection')),
        );
        link.send(
          JSON.stringify({
            type: 'hello',
            version: Relay.PROTOCOL_VERSION,
          } satisfies Relay.HelloFrame),
        );
      },
    );
    if (welcome?.type === 'refused') throw new Error(welcome.reason);
    if (welcome?.type !== 'welcome')
      throw new Error('That computer answered something unexpected');
    const theirs = parseRecords(welcome.members);
    const vouch = approveMember(
      [...(theRegistry().records() ?? []), ...theirs],
      own,
      {
        publicKey: machine.publicKey,
        machineId: machine.id,
        name: machine.name,
        kind: asKind(welcome.machineKind),
      },
      Date.now(),
    );
    await absorb([...theirs, vouch]);
  } finally {
    raw.close(1000, 'Joined');
  }
  await pullMembers();
}

/**
 * Folds membership records in from anywhere (the relay, a link, this computer's own signatures), then works out again who
 * this computer trusts: devices and followed machines follow, and anything new reaches the relay and every connected
 * device. One at a time, so two arrivals never lose each other's records.
 */
function absorb(incoming: MemberRecord[]): Promise<void> {
  const run = absorbing.then(() => applyRecords(incoming));
  absorbing = run.catch(() => {});
  return run;
}

async function applyRecords(incoming: MemberRecord[]) {
  await sodium.ready;
  const self = await theKeys();
  const registry = theRegistry();
  const held = registry.records();
  const merged = mergeRecords(held ?? legacyRecords(self), incoming);
  const resolved = resolveMembers(merged.records, self);
  const fresh = vouches(
    merged.records,
    resolved,
    self,
    {
      machineId: registry.machineId,
      name: settings.machineName || hostname(),
      kind: THIS_KIND,
    },
    Date.now(),
  );
  const records = mergeRecords(merged.records, fresh).records;
  const isChanged = !held || merged.changed || fresh.length > 0;
  if (!isChanged && membership) return;
  membership = resolved;
  if (isChanged) registry.saveRecords(records);
  for (const id of registry.reconcile(
    [...resolved.members.values()],
    deviceId(self.publicKey),
  ))
    server?.disconnect(id);
  syncFollowers();
  broadcast();
  if (!isChanged) return;
  server?.publishMembers(records);
  // GAP: a failed publish waits for the next change or connection to reach the relay; links still carry the records.
  if (currentAccount().status === 'signed-in')
    await accessToken()
      .then((token) => publishMembers(token, records))
      .catch(() => {});
}

/** Pairings from before membership: this computer signs a record for each, dated when it paired. */
function legacyRecords(self: DeviceKeys): MemberRecord[] {
  const { devices, machines } = theRegistry().legacy();
  return [
    ...machines.map((m) =>
      signMember(
        self,
        { publicKey: m.publicKey, machineId: m.id, name: m.name, kind: m.kind },
        m.pairedAt,
      ),
    ),
    ...devices.map((d) =>
      signMember(
        self,
        { publicKey: d.publicKey, name: d.name, kind: d.kind },
        d.pairedAt,
      ),
    ),
  ];
}

/** The account's records from the relay, when signed in. Offline computers catch up here when they next connect. */
async function pullMembers() {
  if (currentAccount().status !== 'signed-in') return;
  const listed = await accessToken()
    .then(listMembers)
    .catch(() => null);
  if (listed) await absorb(parseRecords(listed));
}

const ownRecords = () => theRegistry().records() ?? [];

/** The main window's latest copy of a followed machine's thread files, kept for the next launch and for reading them offline. */
export function cacheMachine(
  sender: WebContents,
  machineId: string,
  saved: string,
) {
  if (sender !== mainWindow()?.webContents || !followers.has(machineId)) return;
  theCache().write(machineId, saved);
}

/** Each cached thread file that still decodes; a cache from before `thread` streams (a whole store) yields none. */
export const cachedMachines = () =>
  [...followers.keys()].flatMap((machineId) => {
    const saved = theCache().read(machineId);
    const threads =
      saved === undefined
        ? undefined
        : Option.getOrUndefined(decodeCache(saved));
    if (!threads) return [];
    const valid = Object.entries(threads).flatMap(([id, file]) =>
      Option.match(decodeThread(file), {
        onNone: () => [],
        onSome: (thread) => [[id, thread] as const],
      }),
    );
    return [{ machineId, saved: JSON.stringify(Object.fromEntries(valid)) }];
  });
const decodeCache = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const decodeThread = Schema.decodeUnknownOption(Persist.SavedThread);

export const followedMachines = (): FollowedMachine[] =>
  [...followers.values()].map((f) => f.state());

/** The main window's store starts its mirrors empty; every followed machine starts over, each thread from its snapshot. */
export function follow(sender: WebContents) {
  if (sender !== mainWindow()?.webContents) return;
  for (const follower of followers.values()) follower.resync();
}

export function commandMachine(
  machineId: string,
  command: RemoteCommand,
): Promise<CommandResult> {
  const follower = followers.get(machineId);
  return follower
    ? follower.command(command)
    : Promise.resolve({
        isOk: false,
        error: 'This computer isn’t paired with that one',
      });
}

/** One follower per paired machine: new ones start, forgotten ones stop. */
function syncFollowers() {
  const machines = theRegistry().machines();
  for (const [id, follower] of followers) {
    if (machines.some((m) => m.id === id && m.publicKey === follower.publicKey))
      continue;
    follower.close();
    followers.delete(id);
    theCache().remove(id);
  }
  for (const machine of machines) {
    const follower = followers.get(machine.id);
    // It refused this computer before it heard this one joined; it may know now.
    if (follower?.state().status === 'refused') follower.resync();
    if (!follower) followers.set(machine.id, startFollowing(machine));
  }
  broadcastMachines();

  function startFollowing(machine: PairedMachine) {
    const follower = followMachine({
      machine: { ...machine, lastSeenAt: theCache().savedAt(machine.id) },
      routes: () => routesTo(machine.id),
      secure: async (raw) => {
        await sodium.ready;
        return secureAsDevice(
          raw,
          await theKeys(),
          sodium.from_base64(
            machine.publicKey,
            sodium.base64_variants.ORIGINAL,
          ),
          settings.machineName || hostname(),
          true,
        );
      },
      onChange: (state) => {
        broadcastMachines();
        broadcast();
        // A refusal may mean it removed this computer: the records say so, and whether to join again.
        if (state.status === 'refused') void pullMembers();
      },
      onFrame: (frame) =>
        mainWindow()?.webContents.send('remote:onMachineFrame', {
          machineId: machine.id,
          frame,
        }),
      onTerminal: (output) =>
        mainWindow()?.webContents.send('remote:onTerminalOutput', {
          machineId: machine.id,
          ...output,
        }),
      onWelcome: (welcome) => theRegistry().noteWelcome(machine.id, welcome),
      members: ownRecords,
      onMembers: (members) => void absorb(parseRecords(members)),
      onRejected: (reason) =>
        logToCore('Warn', `remote: ${machine.name}: ${reason}`),
    });
    return Object.assign(follower, { publicKey: machine.publicKey });
  }
}

/** Its LAN and Tailscale addresses as it last told this computer, then the relay. */
function routesTo(machineId: string): Route[] {
  const addresses =
    theRegistry()
      .machines()
      .find((m) => m.id === machineId)?.addresses ?? [];
  return [
    ...addresses.map((address) => ({
      kind: 'lan' as const,
      open: () => openLan(address),
    })),
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
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send('remote:onMachines', machines);
}

/** A device's command, which Core hands to main (the `remote` capability): the main window's store runs it. */
export const runDeviceCommand = (request: RemoteCommandRequest) =>
  askRenderer(
    results,
    'remote:onCommand',
    randomUUID(),
    COMMAND_TIMEOUT_MS,
    (id) => ({ ...request, id }),
  ).catch((e: unknown): CommandResult => ({
    isOk: false,
    error: e instanceof Error ? e.message : String(e),
  }));

function askRenderer<T>(
  pending: Map<string, (value: T) => void>,
  channel: string,
  id: string,
  timeoutMs: number,
  payload: (id: string) => unknown,
) {
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
    const hosts = [
      '127.0.0.1',
      ...(settings.allowsNetwork ? networkHosts() : []),
    ];
    try {
      server = await startRemoteServer({
        hosts,
        port: REMOTE_PORT,
        secure,
        coreFor: deviceTunnel,
        onRejected: (device, reason) =>
          logToCore('Warn', `remote: ${device}: ${reason}`),
        machineName: () => settings.machineName || hostname(),
        onDevicesChange: broadcast,
        members: ownRecords,
        onMembers: (members) => void absorb(parseRecords(members)),
      });
    } catch (e) {
      error =
        (e as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? `Port ${REMOTE_PORT} is already in use`
          : String(e);
    }
    if (
      server &&
      settings.reachesAnywhere &&
      currentAccount().status === 'signed-in'
    )
      await startRelay(server);
    broadcast();
  });
  return restarting;
}

async function startRelay(listening: RemoteServer) {
  await sodium.ready;
  relay = connectMachine({
    machineId: theRegistry().machineId,
    name: () => settings.machineName || hostname(),
    publicKey: sodium.to_base64(
      (await theKeys()).publicKey,
      sodium.base64_variants.ORIGINAL,
    ),
    token: () => accessToken(),
    onChannel: (raw) => listening.attach(raw),
    onState: (state) => {
      relayState = state;
      broadcast();
    },
    onMembers: () => void pullMembers(),
    onMalformed: (frame) =>
      logToCore(
        'Warn',
        `remote: the relay sent a malformed control frame: ${frame.slice(0, 200)}`,
      ),
  });
}

/** Remote on with no window: a hidden one runs the store. Remote off: a hidden main window closes for real. */
function keepRendererAlive() {
  const win = mainWindow();
  if (settings.isEnabled && !win) createWindow('', undefined, true);
  if (!settings.isEnabled && win && !win.isVisible()) win.close();
}

/** Awake while devices may control this computer and something is going on: a turn in flight, or a device connected. */
function syncAwake() {
  holdAwake(
    settings.isEnabled &&
      settings.keepsAwake &&
      (isAnyBusy() || !!server?.devices().length),
  );
}

/** Every change to settings or connected devices lands here, so keep-awake follows it too. */
function broadcast() {
  syncAwake();
  const status = remoteStatus();
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send('remote:onStatus', status);
}

function loadSettings(): RemoteSettings {
  try {
    const saved = JSON.parse(
      readFileSync(file(), 'utf8'),
    ) as Partial<RemoteSettings>;
    return {
      isEnabled: saved.isEnabled === true,
      allowsNetwork: saved.allowsNetwork === true,
      machineName:
        typeof saved.machineName === 'string' ? saved.machineName : '',
      reachesAnywhere: saved.reachesAnywhere === true,
      keepsAwake: saved.keepsAwake !== false,
    };
  } catch {
    return DEFAULTS;
  }
}
