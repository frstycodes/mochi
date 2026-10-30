import {
  app,
  BrowserWindow,
  powerMonitor,
  safeStorage,
  type WebContents,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import sodium from 'libsodium-wrappers';
import { Effect, Option, Schema } from 'effect';
import { Persist } from '@mochi/schema';
import type { MochiAccount } from '@mochi/domain/host/types/account';
import { coreClient, logToCore, mainCoreClient } from '@mochi/core/host';
import { makeHostCaller } from '@mochi/core/hostClient';
import { watchNetwork } from '@mochi/core/remote/interfaces';
import { networkChanged } from '@mochi/core/remote/reconnect';
import { deviceId, secureAsDevice } from '@mochi/core/remote/pairing';
import type { PairedMachine } from '@mochi/core/remote/registry';
import { openDeviceChannel } from '@mochi/core/remote/relayClient';
import { routesTo as routes } from '@mochi/core/remote/routes';
import type { Paired } from '@mochi/core/remote/service';
import type { DeviceKeys } from '@mochi/core/remote/session';
import type {
  CommandResult,
  FollowedMachine,
  RemoteCommand,
  RemoteCommandRequest,
  RemoteStatus,
} from '../../src/host/types/remote.ts';
import { createWindow, mainWindow } from '../window.ts';
import { MachineCache } from './cache.ts';
import { followMachine, type MachineFollower } from './client.ts';

// Core serves remote access itself (packages/core/src/remote/service.ts): Settings › Remote access, who this computer
// trusts, the server devices reach it on. Main follows your other computers as a device, runs a device's command in the
// main window's store, and keeps that window alive while devices need it.

const COMMAND_TIMEOUT_MS = 30_000;

let isEnabled = false;
let machineName = '';
let paired: Paired = { machines: [], records: [] };
let isQuitting = false;
let cache: MachineCache | undefined;
const theCache = () =>
  (cache ??= new MachineCache(app.getPath('userData'), safeStorage));
let keys: Promise<DeviceKeys> | undefined;
/** This computer's member key, from Core, which keeps it. */
const theKeys = () =>
  (keys ??= core((client) => client['remote.deviceKey']()).then(
    async (seed) => {
      await sodium.ready;
      return sodium.crypto_sign_seed_keypair(sodium.from_base64(seed));
    },
    (error: unknown) => {
      keys = undefined;
      throw error;
    },
  ));
const results = new Map<string, (result: CommandResult) => void>();
/** The computers this one follows as a device, by machine id. */
const followers = new Map<string, MachineFollower & { publicKey: string }>();

type Client = Awaited<ReturnType<typeof coreClient>>;
const core = async <A, E>(call: (client: Client) => Effect.Effect<A, E>) =>
  Effect.runPromise(call(await coreClient()));

/** An access token for the relay route, from Core: in a request header, never a URL, and never in a window. */
const relayToken = () => core((client) => client['account.relayToken']());

/** Follows Core's remote access: keeps the main window alive while it is on, and follows the machines it paired with. */
export function startRemote() {
  app.on('before-quit', () => (isQuitting = true));
  // While remote is on, closing the main window hides it: the store lives in its renderer, and devices need it running.
  app.on('browser-window-created', (_event, win) => {
    win.on('close', (event) => {
      if (!isEnabled || isQuitting || win !== mainWindow()) return;
      event.preventDefault();
      win.hide();
    });
    // A page's own `window.close()` skips the `close` event and destroys the window: bring a hidden one back.
    win.on('closed', () => !isQuitting && keepRendererAlive());
  });
  app.on('will-quit', () => followers.forEach((f) => f.close()));
  // Waking or unlocking may mean another network: redial followed computers now, not after their backoff.
  powerMonitor.on('resume', networkChanged);
  powerMonitor.on('unlock-screen', networkChanged);
  watchNetwork(networkChanged);
  powerMonitor.on('on-battery', reportShell);
  powerMonitor.on('on-ac', reportShell);
  void mainCoreClient()
    .then(async (client) => {
      noteRemoteStatus(
        (await makeHostCaller(client)('remote.status', [])) as RemoteStatus,
      );
      notePaired(
        (await Effect.runPromise(client['remote.paired']())) as Paired,
      );
      reportShell();
    })
    .catch((error: unknown) =>
      logToCore('Warn', `remote: couldn’t read Core’s: ${String(error)}`),
    );
}

/** What main does with Core's pushes about remote access and the account; true for one only main hears. */
export function hearRemotePush(channel: string, payload: unknown): boolean {
  if (channel === 'account:onChange') noteAccount(payload as MochiAccount);
  if (channel === 'remote:onStatus') noteRemoteStatus(payload as RemoteStatus);
  if (channel === 'remote:onApproval') showForApproval();
  if (channel !== 'remote:onPaired') return false;
  notePaired(payload as Paired);
  return true;
}

/** Core's `remote:onStatus`: the window stays alive while remote access is on. */
function noteRemoteStatus(status: RemoteStatus) {
  machineName = status.settings.machineName;
  if (isEnabled === status.settings.isEnabled) return;
  isEnabled = status.settings.isEnabled;
  keepRendererAlive();
}

/** Core's `remote:onPaired`: the machines to follow changed, or what this computer sends them. */
function notePaired(next: Paired) {
  paired = next;
  syncFollowers();
}

/** "Allow <name>?" shows in the main window, brought to front: it may be hidden while devices keep Mochi running. */
function showForApproval() {
  const win = mainWindow();
  win?.show();
  win?.focus();
}

/** Signing in opens the relay route to computers that weren't reachable; signing out ends it. */
function noteAccount(account: MochiAccount) {
  for (const follower of followers.values()) {
    const { status, route } = follower.state();
    if (
      account.status === 'signed-in' ? status !== 'online' : route === 'relay'
    )
      follower.resync();
  }
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
  const { machines } = paired;
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
  reportShell();

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
          machineName || hostname(),
          true,
        );
      },
      onChange: (state) => {
        broadcastMachines();
        reportShell();
        // A refusal may mean it removed this computer: the records say so, and whether to join again.
        if (state.status === 'refused')
          void core((client) => client['remote.absorb']({})).catch(() => {});
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
      onWelcome: (welcome) =>
        void core((client) =>
          client['remote.noteWelcome']({ machineId: machine.id, ...welcome }),
        ).catch(() => {}),
      members: () => paired.records,
      onMembers: (members) =>
        void core((client) => client['remote.absorb']({ members })).catch(
          () => {},
        ),
      onRejected: (reason) =>
        logToCore('Warn', `remote: ${machine.name}: ${reason}`),
    });
    return Object.assign(follower, { publicKey: machine.publicKey });
  }
}

/** Its addresses as the relay holds them sealed and as its last welcome listed them, dialled together, then the relay. */
function routesTo(machineId: string) {
  return routes({
    machineId,
    known: paired.machines.find((m) => m.id === machineId)?.addresses ?? [],
    token: relayToken,
    keys: theKeys,
    relay: {
      kind: 'relay',
      open: async () => {
        const [token, own] = await Promise.all([relayToken(), theKeys()]);
        return openDeviceChannel(machineId, deviceId(own.publicKey), token);
      },
    },
  });
}

function broadcastMachines() {
  const machines = followedMachines();
  for (const win of BrowserWindow.getAllWindows())
    win.webContents.send('remote:onMachines', machines);
}

/** What only main knows, for Core's `host.remote.status`: the power source, and each followed machine's connection. */
function reportShell() {
  const shell = {
    isOnBattery: powerMonitor.isOnBatteryPower(),
    machines: followedMachines(),
  };
  void core((client) => client['remote.shell'](shell)).catch(() => {});
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

/** Remote on with no window: a hidden one runs the store. Remote off: a hidden main window closes for real. */
function keepRendererAlive() {
  const win = mainWindow();
  if (isEnabled && !win) createWindow('', undefined, true);
  if (!isEnabled && win && !win.isVisible()) win.close();
}
