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
import { coreUrl } from '../client.ts';
import { Backend } from '../backend/backend.ts';
import { Capabilities } from '../hostServer.ts';
import { KeyStore, type Keys } from '../keys/keyStore.ts';
import { networkHosts } from './interfaces.ts';
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
 * waiting for main's keychain when that file is there: a new key would end every pairing. With neither, a new one, which
 * waits for the keychain too when `hasKeychain` (desktop), so it is sealed from the start.
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
  const seed = legacy
    ? await capabilities.whenOffered('secureStorage').then(() =>
        Effect.runPromise(
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
        ).then(String),
      )
    : sodium.to_base64(sodium.randombytes_buf(sodium.crypto_sign_SEEDBYTES));
  if (hasKeychain) await capabilities.whenOffered('secureStorage');
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
  let core: (value: { port: number; token: string }) => void;
  const coreEndpoint = new Promise<{ port: number; token: string }>(
    (resolve) => (core = resolve),
  );
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

  /** "Allow <name>?" in an interface on this computer; none open answers No at once. */
  function approve(request: { name: string; code: string }): Promise<boolean> {
    if (!capabilities.offers('remote')) return Promise.resolve(false);
    const id = randomUUID();
    const asked: ApprovalRequest = {
      id,
      name: request.name,
      pairingCode: request.code,
      expiresAt: Date.now() + APPROVAL_TIMEOUT_MS,
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => answer(false), APPROVAL_TIMEOUT_MS);
      function answer(isAllowed: boolean) {
        clearTimeout(timer);
        approvals.delete(id);
        resolve(isAllowed);
      }
      approvals.set(id, answer);
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
  async function join(machineId: string) {
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
      const vouch = approveMember(
        [...(theRegistry().records() ?? []), ...theirs],
        own,
        {
          publicKey: machine.publicKey,
          machineId: machine.id,
          name: machine.name,
          kind: asKind(welcome.backend.kind),
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
    // GAP: a failed publish waits for the next change or connection to reach the relay; links still carry the records.
    if (await isSignedIn())
      await account
        .accessToken()
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
    const listed = await account
      .accessToken()
      .then(listMembers)
      .catch(() => null);
    if (listed) await absorb(parseRecords(listed));
  }

  const ownRecords = () => theRegistry().records() ?? [];
  const paired = (): Paired => ({
    machines: theRegistry().machines(),
    records: ownRecords(),
  });

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
      // GAP: addresses are read once here; after joining another network, turn the setting off and on to bind the new one.
      const hosts = [
        '127.0.0.1',
        ...(settings.allowsNetwork ? networkHosts() : []),
      ];
      try {
        server = await startRemoteServer({
          hosts,
          port,
          secure,
          coreFor: async (grant) => {
            const endpoint = await coreEndpoint;
            return {
              url: coreUrl(endpoint.port, '').split('#')[0]!,
              token: mintDeviceToken(endpoint.token, grant),
            };
          },
          onRejected: (device, reason) => log(`${device}: ${reason}`),
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
        error =
          (e as NodeJS.ErrnoException).code === 'EADDRINUSE'
            ? `Port ${port} is already in use`
            : String(e);
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
      name: machineName,
      publicKey: sodium.to_base64(
        own.publicKey,
        sodium.base64_variants.ORIGINAL,
      ),
      token: () => account.accessToken(),
      onChannel: (raw) => listening.attach(raw),
      onState: (state) => {
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
    if (next.status === 'signed-in') void pullMembers();
  });

  return {
    /** Starts listening when Settings › Remote access is on, and reads the account's records. */
    start() {
      identify();
      if (settings.isEnabled) void restart();
      void absorb([])
        .then(pullMembers)
        .catch((e: unknown) => log(`Couldn’t read the members: ${String(e)}`));
    },
    /** Core's own socket, once bound: where a device's tunnel reaches it, and the token its device tokens are signed with. */
    bindCore: (endpoint: { port: number; token: string }) => core(endpoint),
    status,
    set,
    removeMember,
    setDeviceScopes,
    answerApproval: (id: string, isAllowed: boolean) =>
      approvals.get(id)?.(isAllowed),
    otherMachines,
    join,
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
  { hasKeychain }: { hasKeychain: boolean },
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
