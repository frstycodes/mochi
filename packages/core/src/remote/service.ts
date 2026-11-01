import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import sodium from 'libsodium-wrappers';
import { Effect, Layer, Option, Schema } from 'effect';
import { Relay } from '@mochi/schema';
import type {
  ApprovalRequest,
  FollowedMachine,
  MemberInfo,
  OtherMachine,
  RelayState,
  RemoteSettings,
  RemoteStatus,
  Scope,
} from '../../../../apps/desktop/src/host/types/remote.ts';
import type { MochiAccount } from '@mochi/domain/host/types/account';
import { AccountService } from '../account/service.ts';
import { isAnyBusy, onBusy, push } from '../agents/events.ts';
import { Backend } from '../backend/backend.ts';
import { Capabilities } from '../hostServer.ts';
import { KeyStore, type Keys } from '../keys/keyStore.ts';
import { networkHosts, watchNetwork } from './interfaces.ts';
import { networkChanged } from './reconnect.ts';
import { asCandidate } from './routes.ts';
import { Remote } from './tag.ts';
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
import { Registry, type PairedMachine } from './registry.ts';
import {
  openMachineInfo,
  openRecords,
  sealMachineInfo,
  sealRecords,
} from './sealed.ts';
import {
  connectMachine,
  forgetMachineAtRelay,
  listMachines,
  listMembers,
  openDeviceChannel,
  publishMembers,
  type MachineConnection,
} from './relayClient.ts';
import type { RawLink } from './link.ts';
import { startRemoteServer, type RemoteServer } from './server.ts';
import type { DeviceKeys } from './session.ts';
import { mintDeviceToken } from './token.ts';

/** One fixed port; a setting if it collides with something users run. `MOCHI_REMOTE_PORT` lets a dev run sit beside an installed Mochi. */
export const REMOTE_PORT = Number(process.env.MOCHI_REMOTE_PORT) || 47373;

/** Every window hears these; main also shows the main window for an approval. */
const STATUS_CHANNEL = 'remote:onStatus';
const APPROVAL_CHANNEL = 'remote:onApproval';
/** Main's alone: the computers it follows as a device, and the records it sends them. */
const PAIRED_CHANNEL = 'remote:onPaired';

/** This computer's member key in `Keys`: its Ed25519 seed, base64. */
export const DEVICE_KEY = 'deviceKey';

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

/** What main follows: every paired machine, and this computer's records it sends each in its hello. */
export interface Paired {
  machines: PairedMachine[];
  records: MemberRecord[];
}

/** What only main knows: the power source, and how its connection to each machine it follows stands. */
export interface Shell {
  isOnBattery: boolean;
  machines: readonly FollowedMachine[];
}

/**
 * The device key's seed. It moves into `Keys` from main's `<userData>/device-key` (sealed with `safeStorage`) on first use,
 * waiting for main when that file is there: a new key would end every pairing. With neither, a new one. When `hasKeychain`
 * (desktop), both wait for main to connect, so the key is sealed from the start whenever main offers `secureStorage`; main
 * leaves it out where `safeStorage` can't seal (Linux with `basic_text`), and the key is kept plain in `Keys`' 0600 file.
 */
export async function deviceSeed(
  keys: Keys,
  capabilities: Capabilities['Service'],
  dir: string,
  hasKeychain = false,
): Promise<string> {
  const saved = await readKey(keys, capabilities);
  if (saved !== undefined) return saved;
  const file = joinPath(dir, 'device-key');
  const legacy = await readFile(file).catch(() => undefined);
  await sodium.ready;
  // Main registers every capability it serves at once, so once it connects `secureStorage` is offered or never will be.
  if (legacy || hasKeychain) await capabilities.whenOffered('main');
  const seed =
    legacy && capabilities.offers('secureStorage')
      ? await Effect.runPromise(
          capabilities
            .call({
              capability: 'secureStorage',
              method: 'decrypt',
              args: [legacy.toString('base64')],
            })
            .pipe(
              Effect.catch((e) =>
                Effect.die(typeof e === 'string' ? new Error(e) : e),
              ),
            ),
        ).then(String)
      : // Weak storage never wrote that file, but one it can't open now is no key: a new one.
        sodium.to_base64(sodium.randombytes_buf(sodium.crypto_sign_SEEDBYTES));
  await keys.set(DEVICE_KEY, seed);
  await rm(file, { force: true });
  return seed;
}

/** A key sealed by main's keychain reads once main serves it again. */
async function readKey(keys: Keys, capabilities: Capabilities['Service']) {
  try {
    return await keys.get(DEVICE_KEY);
  } catch (error) {
    if (capabilities.offers('secureStorage')) throw error;
    await capabilities.whenOffered('secureStorage');
    return keys.get(DEVICE_KEY);
  }
}

const fromSeed = (seed: string): DeviceKeys => {
  const { publicKey, privateKey } = sodium.crypto_sign_seed_keypair(
    sodium.from_base64(seed),
  );
  return { publicKey, privateKey };
};

/**
 * Where a device's tunnel reaches Core: its own socket, as bound. Under TLS (`mochi serve --tls-cert`) it is `wss`, and `ca` is
 * Core's own certificate, the only one the tunnel trusts.
 */
export interface CoreEndpoint {
  url: string;
  /** Signs each device's token (`mintDeviceToken`); never leaves this process. */
  token: string;
  ca?: Buffer;
}

interface RemoteOptions {
  /** Where `remote.json` and `devices.json` live. */
  dir: string;
  port: number;
  keys: Keys;
  account: AccountService['Service'];
  capabilities: Capabilities['Service'];
  /** `backend.info`: this Remote names the machine there (its relay id and chosen name), and sends it in each welcome. */
  backend: Backend['Service'];
  hasKeychain: boolean;
  log: (message: string) => void;
  /** `mochi serve`'s output: set, it turns remote access on once signed in and joins your computers (`serveAlone`). */
  serving?: (line: string) => void;
}

/**
 * The machine side of remote access: Settings › Remote access, who this computer trusts (membership records), the server
 * devices reach it on, its relay connection and keep-awake. Main follows your other computers (`electron/remote`).
 */
function makeRemote({
  dir,
  port,
  keys,
  account,
  capabilities,
  backend,
  hasKeychain,
  log,
  serving,
}: RemoteOptions) {
  const file = joinPath(dir, 'remote.json');
  let settings = loadSettings(file);
  let server: RemoteServer | undefined;
  let relay: MachineConnection | undefined;
  let relayState: RelayState = { status: 'off' };
  let error: string | undefined;
  let restarting: Promise<void> = Promise.resolve();
  let shell: Shell = { isOnBattery: false, machines: [] };
  let isHeld = false;
  let stopWatching: (() => void) | undefined;
  const approvals = new Map<string, (isAllowed: boolean) => void>();
  /** Who this computer trusts, from the records in `devices.json`; set by the first `absorb`. */
  let membership: Membership | undefined;
  let absorbing: Promise<unknown> = Promise.resolve();
  let registry: Registry | undefined;
  const theRegistry = () => (registry ??= new Registry(dir));
  let seed: Promise<string> | undefined;
  const theSeed = () =>
    (seed ??= deviceSeed(keys, capabilities, dir, hasKeychain).catch(
      (e: unknown) => {
        seed = undefined;
        throw e;
      },
    ));
  const theKeys = async () => {
    const value = await theSeed();
    await sodium.ready;
    return fromSeed(value);
  };
  let core: (value: CoreEndpoint) => void;
  const coreEndpoint = new Promise<CoreEndpoint>((resolve) => (core = resolve));
  const isSignedIn = async () =>
    (await account.current()).status === 'signed-in';
  const machineName = () => settings.machineName || hostname();

  function status(): RemoteStatus {
    const registry = theRegistry();
    const members = registry
      .devices()
      .map(({ id, name, kind, scopes, pairedAt, publicKey }): MemberInfo => {
        const machine = registry
          .machines()
          .find((m) => m.publicKey === publicKey);
        const followed =
          machine && shell.machines.find((f) => f.id === machine.id);
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
      isOnBattery: shell.isOnBattery,
      ...(error && { error }),
    };
  }

  async function set(patch: Partial<RemoteSettings>) {
    const previous = settings;
    settings = { ...settings, ...patch };
    writeFileSync(file, JSON.stringify(settings), { mode: 0o600 });
    // Its own record carries its name: renaming signs a new one.
    if (settings.machineName !== previous.machineName) {
      void absorb([]);
      identify();
    }
    if (
      settings.isEnabled !== previous.isEnabled ||
      settings.allowsNetwork !== previous.allowsNetwork ||
      settings.reachesAnywhere !== previous.reachesAnywhere
    )
      await restart();
    else broadcast();
    return status();
  }

  /**
   * Removes a member from all your computers: a signed removal, spread like any record, ends its connections wherever it
   * arrives. It joins again only with a new approval.
   */
  async function removeMember(id: string) {
    const machineId = theRegistry()
      .machines()
      .find((m) => m.publicKey === theRegistry().findDevice(id)?.publicKey)?.id;
    await absorb([signRemoval(await theKeys(), id, Date.now())]);
    // Off the relay's list too, which closes its relay socket; it registers again if it is still running, as a stranger.
    if (machineId && (await isSignedIn()))
      await forgetMachineAtRelay(await account.accessToken(), machineId).catch(
        () => {},
      );
    return status();
  }

  /** New scopes take effect on the device's next connection: its open ones end now, so nothing runs under the old ones. */
  function setDeviceScopes(id: string, scopes: Scope[]) {
    theRegistry().setScopes(id, scopes);
    server?.disconnect(id);
    broadcast();
    return status();
  }

  /**
   * "Allow <name>?" in an interface on this computer; none open answers No at once. When the asking computer leaves, the
   * prompt is sent again with its deadline now, which closes it.
   */
  function approve(
    request: { name: string; code: string },
    left?: AbortSignal,
  ): Promise<boolean> {
    if (!capabilities.offers('remote') || left?.aborted)
      return Promise.resolve(false);
    const id = randomUUID();
    const asked: ApprovalRequest = {
      id,
      name: request.name,
      pairingCode: request.code,
      expiresAt: Date.now() + APPROVAL_TIMEOUT_MS,
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => answer(false), APPROVAL_TIMEOUT_MS);
      const onLeft = () => {
        answer(false);
        push({
          channel: APPROVAL_CHANNEL,
          payload: { ...asked, expiresAt: Date.now() },
        });
      };
      function answer(isAllowed: boolean) {
        clearTimeout(timer);
        left?.removeEventListener('abort', onLeft);
        approvals.delete(id);
        resolve(isAllowed);
      }
      approvals.set(id, answer);
      left?.addEventListener('abort', onLeft, { once: true });
      push({ channel: APPROVAL_CHANNEL, payload: asked });
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
  async function otherMachines(): Promise<OtherMachine[]> {
    const [listed, own] = await Promise.all([
      account.accessToken().then(listMachines),
      theKeys(),
      pullMembers(),
    ]);
    const registry = theRegistry();
    const isMember = (publicKey: string) =>
      publicKey ===
        sodium.to_base64(own.publicKey, sodium.base64_variants.ORIGINAL) ||
      registry.devices().some((d) => d.publicKey === publicKey);
    return listed
      .filter((m) => m.id !== registry.machineId && !isMember(m.publicKey))
      .map((m) => {
        const code = pairingCode(
          sodium.from_base64(m.publicKey, sodium.base64_variants.ORIGINAL),
          own.publicKey,
        );
        return {
          id: m.id,
          // Its name is sealed to its members, which this computer isn't yet; an older machine still lists one in clear.
          name: openMachineInfo(m, own)?.name ?? m.name ?? `Computer ${code}`,
          isOnline: m.isOnline,
          pairingCode: code,
        };
      });
  }

  /**
   * Joins your computers through one of them: through the relay, its key checked against the relay's listing and, by you,
   * the code on both screens. Once it allowed this one, each vouches for the other, and every member's records reach this
   * computer, so it reaches all of them and they it with no more prompts.
   */
  async function join(machineId: string, signal?: AbortSignal) {
    let joinedName = '';
    const token = await account.accessToken();
    const [listed, own] = await Promise.all([listMachines(token), theKeys()]);
    const machine = listed.find((m) => m.id === machineId);
    if (!machine)
      throw new Error('That computer isn’t on your account anymore');
    if (!machine.isOnline) throw new Error('That computer is offline');
    const machineKey = sodium.from_base64(
      machine.publicKey,
      sodium.base64_variants.ORIGINAL,
    );
    const raw = await openDeviceChannel(
      machineId,
      deviceId(own.publicKey),
      token,
    );
    // Closing the channel ends the attempt, and dismisses the prompt on that computer (`secureAsMachine`).
    const stop = () => raw.close(1000, 'Joined through another computer');
    if (signal?.aborted) stop();
    signal?.addEventListener('abort', stop, { once: true });
    try {
      const link = await secureAsDevice(raw, own, machineKey, machineName());
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
      joinedName = welcome.backend.name;
      const vouch = approveMember(
        [...(theRegistry().records() ?? []), ...theirs],
        own,
        {
          publicKey: machine.publicKey,
          machineId: machine.id,
          // From inside the session: the relay's listing has no name it can read.
          name: welcome.backend.name,
          kind: asKind(welcome.backend.kind),
        },
        Date.now(),
      );
      await absorb([...theirs, vouch]);
    } finally {
      signal?.removeEventListener('abort', stop);
      raw.close(1000, 'Joined');
    }
    await pullMembers();
    return joinedName;
  }

  let alone: ReturnType<typeof progressLog> | undefined;

  /**
   * A computer with no screen (`mochi serve`) joins your computers by asking every online one of them at once, each showing
   * "Let <name> join?" with the code this one prints. The first that allows it wins and the other prompts close; account
   * access alone never makes it a member. One run at a time: a second caller follows the one in flight.
   */
  function joinAlone(onProgress: (progress: JoinProgress) => void) {
    if (!alone || alone.isDone()) {
      const run = (alone = progressLog());
      void askEveryone(run.emit).then(run.emit, (e: unknown) =>
        run.emit({ type: 'failed', reason: messageOf(e) }),
      );
    }
    return alone.follow(onProgress);
  }

  async function askEveryone(
    emit: (progress: JoinProgress) => void,
  ): Promise<JoinProgress> {
    if (!(await isSignedIn()))
      return {
        type: 'failed',
        reason: 'Not signed in: run `mochi login` first',
      };
    await absorbing;
    await pullMembers();
    if (theRegistry().devices().length > 0) return { type: 'member' };
    const [listed, own] = await Promise.all([
      account.accessToken().then(listMachines),
      theKeys(),
    ]);
    const self = sodium.to_base64(
      own.publicKey,
      sodium.base64_variants.ORIGINAL,
    );
    const online = listed.filter(
      (m) =>
        m.isOnline && m.id !== theRegistry().machineId && m.publicKey !== self,
    );
    if (online.length === 0)
      return {
        type: 'failed',
        reason:
          'No other computer of yours is online: open Mochi on one, then run `mochi login` again',
      };
    const others = new AbortController();
    const attempts = online.map(async (machine) => {
      const code = pairingCode(
        sodium.from_base64(machine.publicKey, sodium.base64_variants.ORIGINAL),
        own.publicKey,
      );
      // Its name is sealed to its members, which this computer isn't yet.
      const listedName = machine.name ?? `Computer ${code}`;
      emit({
        type: 'asking',
        machineName: listedName,
        name: machineName(),
        code,
      });
      try {
        const name = await join(machine.id, others.signal);
        others.abort();
        return name;
      } catch (e) {
        if (!others.signal.aborted)
          emit({
            type: 'declined',
            machineName: listedName,
            reason: messageOf(e),
          });
        throw e;
      }
    });
    return Promise.any(attempts).then(
      (machineName): JoinProgress => ({ type: 'joined', machineName }),
      (): JoinProgress => ({
        type: 'failed',
        reason: 'No computer of yours allowed this one',
      }),
    );
  }

  /** Under `mochi serve`, once signed in: remote access on, reachable through the relay, and joined when it trusts nobody. */
  async function serveAlone() {
    if (!serving || !(await isSignedIn())) return;
    if (!settings.isEnabled || !settings.reachesAnywhere) {
      await set({ isEnabled: true, reachesAnywhere: true });
      serving(
        `Remote access is on, through the relay as “${machineName()}”: your other computers see it under “Join your computers”.`,
      );
    }
    joinAlone((progress) => serving?.(describeJoin(progress)));
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
    const self = await theKeys();
    const registry = theRegistry();
    const held = registry.records();
    const merged = mergeRecords(held ?? legacyRecords(self), incoming);
    const resolved = resolveMembers(merged.records, self);
    const fresh = vouches(
      merged.records,
      resolved,
      self,
      { machineId: registry.machineId, name: machineName(), kind: THIS_KIND },
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
    push({ channel: PAIRED_CHANNEL, payload: paired() });
    broadcast();
    if (!isChanged) return;
    server?.publishMembers(records);
    // The registration is sealed to the members: a new one can read it, a removed one no longer can.
    relay?.reregister();
    // GAP: a failed publish waits for the next change or connection to reach the relay; links still carry the records.
    if (await isSignedIn())
      await account
        .accessToken()
        .then((token) =>
          publishMembers(token, sealRecords(records, memberKeys(self))),
        )
        .catch(() => {});
  }

  /** Pairings from before membership: this computer signs a record for each, dated when it paired. */
  function legacyRecords(self: DeviceKeys): MemberRecord[] {
    const { devices, machines } = theRegistry().legacy();
    return [
      ...machines.map((m) =>
        signMember(
          self,
          {
            publicKey: m.publicKey,
            machineId: m.id,
            name: m.name,
            kind: m.kind,
          },
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
    if (!(await isSignedIn())) return;
    const own = await theKeys();
    const listed = await account
      .accessToken()
      .then(listMembers)
      .catch(() => null);
    if (listed) await absorb(parseRecords(openRecords(listed, own)));
  }

  /** Every member's key, this computer's included: what the relay's copies are sealed to. */
  function memberKeys(self: DeviceKeys) {
    const keys = [...(membership?.members.values() ?? [])].map((m) =>
      sodium.from_base64(m.publicKey, sodium.base64_variants.ORIGINAL),
    );
    return [self.publicKey, ...keys];
  }

  const ownRecords = () => theRegistry().records() ?? [];
  const paired = (): Paired => ({
    machines: theRegistry().machines(),
    records: ownRecords(),
  });

  /** Loopback always; this computer's private addresses as they are now, when devices on the network are allowed. */
  const hostsNow = () => [
    '127.0.0.1',
    ...(settings.allowsNetwork ? networkHosts() : []),
  ];

  /** An address came or went: listen where this computer is now. Queued behind `restart`, so it never races one. */
  function rebind() {
    restarting = restarting.then(async () => {
      if (!server) return;
      const before = server.addresses.join(' ');
      await server.rebind(hostsNow()).then(
        () => (error = undefined),
        (e: unknown) => (error = String(e)),
      );
      if (server.addresses.join(' ') === before && !error) return;
      // Devices read the addresses from the relay before they dial.
      relay?.reregister();
      broadcast();
    });
    return restarting;
  }

  /** Serialized: toggling quickly never leaves two servers on the port. */
  /** `backend.info` names this machine as the relay and its other computers know it. */
  function identify() {
    void Effect.runPromise(
      backend.identify({ id: theRegistry().machineId, name: machineName() }),
    );
  }

  function restart() {
    restarting = restarting.then(async () => {
      relay?.close();
      relay = undefined;
      await server?.close();
      server = undefined;
      error = undefined;
      if (!settings.isEnabled) return broadcast();
      try {
        server = await startRemoteServer({
          hosts: hostsNow(),
          port,
          secure,
          coreFor: async (grant) => {
            const endpoint = await coreEndpoint;
            return {
              url: endpoint.url,
              token: mintDeviceToken(endpoint.token, grant),
              ...(endpoint.ca && { ca: endpoint.ca }),
            };
          },
          onRejected: (device, reason) => log(`${device}: ${reason}`),
          onPortTaken: (wanted, bound) =>
            log(
              `Port ${wanted} is in use, so remote access listens on ${bound}`,
            ),
          backend: (scopes) =>
            Effect.runPromise(backend.describe(scopes)).then((info) => ({
              ...info,
              capabilities: [...info.capabilities],
              scopes: [...info.scopes],
            })),
          onDevicesChange: broadcast,
          members: ownRecords,
          onMembers: (members) => void absorb(parseRecords(members)),
        });
      } catch (e) {
        error = String(e);
        log(`Remote access couldn’t start: ${error}`);
      }
      if (server && settings.reachesAnywhere && (await isSignedIn()))
        await startRelay(server);
      broadcast();
    });
    return restarting;
  }

  async function startRelay(listening: RemoteServer) {
    const own = await theKeys();
    relay = connectMachine({
      machineId: theRegistry().machineId,
      // Its addresses too, so a device dials direct first; only members can read them.
      sealed: () =>
        sealMachineInfo(
          {
            name: machineName(),
            kind: THIS_KIND,
            addresses: listening.addresses.flatMap(
              (address) => asCandidate(address) ?? [],
            ),
            updatedAt: Date.now(),
          },
          memberKeys(own),
        ),
      publicKey: sodium.to_base64(
        own.publicKey,
        sodium.base64_variants.ORIGINAL,
      ),
      token: () => account.accessToken(),
      onChannel: (raw) => listening.attach(raw),
      onState: (state) => {
        if (state.status === 'error' && relayState.status !== 'error')
          log(`The relay connection failed: ${state.error}`);
        relayState = state;
        broadcast();
      },
      onMembers: () => void pullMembers(),
      onMalformed: (frame) =>
        log(`the relay sent a malformed control frame: ${frame.slice(0, 200)}`),
    });
  }

  /** Awake while devices may control this computer and something is going on: a turn in flight, or a device connected. */
  function syncAwake() {
    const isWanted =
      settings.isEnabled &&
      settings.keepsAwake &&
      (isAnyBusy() || !!server?.devices().length);
    // Without main nothing can hold it; the next change tries again.
    if (isWanted === isHeld || !capabilities.offers('main')) return;
    isHeld = isWanted;
    void Effect.runPromise(
      capabilities.call({
        capability: 'main',
        method: 'holdAwake',
        args: [isWanted],
      }),
    ).catch(() => (isHeld = !isWanted));
  }

  /** Every change to settings or connected devices lands here, so keep-awake follows it too. */
  function broadcast() {
    syncAwake();
    push({ channel: STATUS_CHANNEL, payload: status() });
  }

  const offBusy = onBusy(syncAwake);
  // Signing in or out starts or stops the relay connection.
  const offAccount = account.onChange((next: MochiAccount) => {
    if (settings.isEnabled && settings.reachesAnywhere) void restart();
    if (next.status === 'signed-in') void pullMembers().then(serveAlone);
  });

  return {
    /** Starts listening when Settings › Remote access is on, and reads the account's records. */
    start() {
      identify();
      // On the desktop the account is sealed with main's keychain: read before main connects it reads as signed out, and the
      // relay would never start.
      const ready = hasKeychain
        ? capabilities.whenOffered('main')
        : Promise.resolve();
      void ready.then(() => {
        if (settings.isEnabled) void restart();
      });
      stopWatching ??= watchNetwork(() => {
        networkChanged();
        void rebind();
      });
      void ready
        .then(() => absorb([]))
        .then(pullMembers)
        .then(serveAlone)
        .catch((e: unknown) => log(`Couldn’t read the members: ${String(e)}`));
    },
    /** Core's own socket, once bound: where a device's tunnel reaches it, and the token its device tokens are signed with. */
    bindCore: (endpoint: CoreEndpoint) => core(endpoint),
    status,
    set,
    removeMember,
    setDeviceScopes,
    answerApproval: (id: string, isAllowed: boolean) =>
      approvals.get(id)?.(isAllowed),
    otherMachines,
    join: (machineId: string) => join(machineId).then(() => {}),
    /**
     * `mochi login` following the join from another process: it signed in there, so this Core reads the account again and,
     * under `mochi serve`, turns remote access on first. Ends with `joined`, `member` or `failed`.
     */
    async joinAlone(onProgress: (progress: JoinProgress) => void) {
      if (serving) await serveAlone();
      return joinAlone(onProgress);
    },
    // Main's, for the computers it follows.
    deviceKey: theSeed,
    paired: async () => {
      await absorbing;
      return paired();
    },
    /** A followed machine's records; none fetches the account's, after it refused this computer. */
    absorb: (members: unknown) =>
      members === undefined ? pullMembers() : absorb(parseRecords(members)),
    noteWelcome(
      machineId: string,
      welcome: Pick<PairedMachine, 'addresses' | 'kind'>,
    ) {
      theRegistry().noteWelcome(machineId, welcome);
      push({ channel: PAIRED_CHANNEL, payload: paired() });
    },
    setShell(next: Shell) {
      shell = next;
      broadcast();
    },
    async close() {
      offBusy();
      offAccount();
      stopWatching?.();
      relay?.close();
      await restarting;
      await server?.close();
    },
  };
}

/** What `Remote` serves; its key lives in `tag.ts`, so code that only names the service never loads this module. */
export type RemoteApi = ReturnType<typeof makeRemote>;

export const layerRemote = (
  userData: string | undefined,
  port: number,
  {
    hasKeychain,
    serving,
  }: { hasKeychain: boolean; serving?: (line: string) => void },
) =>
  Layer.effect(
    Remote,
    Effect.gen(function* () {
      const services = yield* Effect.context<never>();
      const remote = makeRemote({
        // Tests run without a data folder; each gets its own scratch one.
        dir: userData ?? mkdtempSync(joinPath(tmpdir(), 'mochi-remote-')),
        port,
        keys: yield* KeyStore,
        account: yield* AccountService,
        capabilities: yield* Capabilities,
        backend: yield* Backend,
        hasKeychain,
        serving,
        log: (message) =>
          void Effect.runPromiseWith(services)(
            Effect.logWarning(message).pipe(
              Effect.annotateLogs({ source: 'remote' }),
            ),
          ),
      });
      yield* Effect.addFinalizer(() => Effect.promise(() => remote.close()));
      // Without a data folder (tests) nothing starts until asked: no key is made in the shared scratch store.
      if (userData) remote.start();
      return remote;
    }),
  );

/** How a headless computer's join goes (`joinAlone`), for `mochi serve` and `mochi login` to print. */
export type JoinProgress =
  | { type: 'asking'; machineName: string; name: string; code: string }
  | { type: 'declined'; machineName: string; reason: string }
  | { type: 'joined'; machineName: string }
  | { type: 'member' }
  | { type: 'failed'; reason: string };

export const isJoinDone = (progress: JoinProgress) =>
  progress.type === 'joined' ||
  progress.type === 'member' ||
  progress.type === 'failed';

export function describeJoin(progress: JoinProgress): string {
  switch (progress.type) {
    case 'asking':
      return `Approve “${progress.name}” on ${progress.machineName}: ${progress.code}`;
    case 'declined':
      return `${progress.machineName}: ${progress.reason}`;
    case 'joined':
      return `Joined your computers: ${progress.machineName} allowed this one.`;
    case 'member':
      return 'Already one of your computers.';
    case 'failed':
      return progress.reason;
  }
}

/** One join's progress so far, replayed to each follower, who is told of the rest until it ends. */
function progressLog() {
  const seen: JoinProgress[] = [];
  const followers = new Set<(progress: JoinProgress) => void>();
  return {
    isDone: () => seen.some(isJoinDone),
    emit: (progress: JoinProgress) => {
      seen.push(progress);
      for (const follower of followers) follower(progress);
      if (isJoinDone(progress)) followers.clear();
    },
    follow(follower: (progress: JoinProgress) => void) {
      for (const progress of seen) follower(progress);
      if (!seen.some(isJoinDone)) followers.add(follower);
      return () => void followers.delete(follower);
    },
  };
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function loadSettings(file: string): RemoteSettings {
  try {
    const saved = JSON.parse(
      readFileSync(file, 'utf8'),
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
