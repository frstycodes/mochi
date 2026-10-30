import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import path from 'node:path';
import {
  Context,
  Effect,
  Layer,
  Queue,
  Schedule,
  Schema,
  Stream,
} from 'effect';
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from 'effect/http';
import { RpcSerialization, RpcServer } from 'effect/rpc';
import { NetAddress } from 'effect/net';
import { NodeHttpServer } from '@effect/platform-node';
import { Capabilities as Contract, definitionOf, Relay } from '@mochi/schema';
import { Backend, type BackendOptions } from './backend/backend.ts';
import { Cache } from './cache.ts';
import { GitHub, GithubTransport } from './github/service.ts';
import { githubHandlers } from './github/handlers.ts';
import {
  Capabilities,
  hostHandlers,
  type LocalCapability,
} from './hostServer.ts';
import { Hosted } from './hosted.ts';
import { AccountService } from './account/service.ts';
import { KeyStore } from './keys/keyStore.ts';
import { Metrics } from './metrics/metrics.ts';
import { CoreWsRpcs, ScopeAuthorization, Unauthorized } from './rpc.ts';
import { scopeOf } from './scopes.ts';
import { verifyDeviceToken, type DeviceGrant } from './remote/token.ts';
import { directCall, type DirectCall } from './remote/adapter.ts';
import {
  isJoinDone,
  layerRemote,
  REMOTE_PORT,
  type JoinProgress,
} from './remote/service.ts';
import { Remote } from './remote/tag.ts';
import { Terminals } from './remote/terminals.ts';
import { visibleItem, visibleSnapshot } from './remote/visible.ts';
import { asRunError, Run } from './run.ts';
import { storeHandlers } from './store/handlers.ts';
import type { DocTable } from './store/migrations.ts';
import { importJson } from './store/importJson.ts';
import { storeCommand } from '../../../apps/desktop/src/remote/storeCommands.ts';
import type { RemoteCommand } from '../../../apps/desktop/src/host/types/remote.ts';
import type { State } from '../../../apps/desktop/src/store/types.ts';
import { AgentCaller, Commands } from './store/commands.ts';
import { Projection } from './store/projection.ts';
import { Store } from './store/store.ts';
import { layerReactor } from './reactor/execute.ts';
import { ThreadContext } from './switch/context.ts';
import { PRIORITY, UtilityQueue } from './utility/queue.ts';
import type { Gate, StaleKind, WatchKey } from './watch/keys.ts';
import { Watch } from './watch/watch.ts';
import {
  agent,
  classify,
  handoffTurn,
  utilityCall,
} from './agents/handlers.ts';
import {
  agentRpcHandlers,
  agentSettingsSaved,
  layerAgents,
} from './agents/layer.ts';
import { Turns } from './agents/turns.ts';
import { scheduleHandlers, scheduleRpcHandlers } from './schedule/handlers.ts';
import { Scheduler } from './schedule/scheduler.ts';

export interface ServerOptions {
  readonly port: number;
  readonly host?: string;
  /** Each accepted token and the scopes a connection made with it gets. One carrying `local` also signs device tokens (`remote/token.ts`). */
  readonly tokens: ReadonlyMap<string, ReadonlyArray<Contract.AuthScope>>;
  /** Page origins allowed to connect. A client that sends no Origin (main, a Node client) needs only the token. */
  readonly origins: ReadonlyArray<string>;
  /** Serve https/wss with this certificate and key. Unset: plain http, which only loopback should use. */
  readonly tls?: { readonly cert: Buffer; readonly key: Buffer };
  /** Mochi's data folder: the store's `mochi.db`, and the JSON files it imports once. Unset: an in-memory store (tests). */
  readonly userData?: string;
  /** The built renderer (`dist/`), served at `/` for a browser (`mochi serve`). Unset: only the socket. */
  readonly ui?: string;
  /** `browserView` served by Core itself while no client offers it (headless Chromium under `mochi serve`). */
  readonly browserView?: LocalCapability;
  /** What `backend.info` says this Core is. Unset: a `server`. */
  readonly backend?: Partial<BackendOptions>;
  /** Where remote access listens for devices when it is on; 0 picks a free port (tests). */
  readonly remotePort?: number;
  /** Main serves `secureStorage` once it connects: a new device key waits for it instead of landing unsealed. */
  readonly hasKeychain?: boolean;
  /** `mochi serve`'s output: once signed in, remote access turns on and joins your computers, printing each code here. */
  readonly serving?: (line: string) => void;
}

/** Everything Core runs, serving RPC on `ws://<host>:<port>/ws`. The `HttpServer` is exposed so tests can read the bound port. */
export const layerCore = (options: ServerOptions) => {
  // Core's own: remote access signs each device's tunnel token with it (`remote/token.ts`). Never leaves this process.
  const internal = randomBytes(32).toString('base64url');
  const tokens = new Map([
    ...options.tokens,
    [internal, Contract.allScopes],
  ] as const);
  return layerRoute({ ...options, tokens }).pipe(
    Layer.provideMerge(layerBindCore(internal, options.tls?.cert)),
    // Built after everything below, right before the route serves: the server listens when built but answers only once served,
    // and an upgrade that arrives in between is never answered, so a client would wait out its 10s open timeout. Until then
    // a connection is refused, and the client redials in 250ms.
    // Sockets are long-lived and never drain on their own, so closing waits only briefly for them.
    Layer.provideMerge(
      NodeHttpServer.layerServer(
        options.tls
          ? () => createHttpsServer(options.tls!) as unknown as Server
          : createServer,
        {
          port: options.port,
          host: options.host ?? '127.0.0.1',
          gracefulShutdownTimeout: '100 millis',
          // Answers with `mochi` alone: the token subprotocol is never echoed back.
          websocket: {
            handleProtocols: (offered) =>
              offered.has(Contract.SUBPROTOCOL) ? Contract.SUBPROTOCOL : false,
          },
        },
      ),
    ),
    Layer.provideMerge(Layer.mergeAll(Cache.layer, layerReactor)),
    Layer.provide(Metrics.layer),
    Layer.provide(Watch.layer),
    Layer.provideMerge(layerAgents(options.userData)),
    Layer.provideMerge(Scheduler.layer),
    Layer.provideMerge(
      ThreadContext.layer((threadId, spaceId, cwd, ask) =>
        Effect.promise(() => handoffTurn(threadId, spaceId, cwd, ask)),
      ),
    ),
    Layer.provideMerge(Hosted.layer(options.userData)),
    Layer.provideMerge(
      layerRemote(options.userData, options.remotePort ?? REMOTE_PORT, {
        hasKeychain: options.hasKeychain ?? false,
        serving: options.serving,
      }),
    ),
    Layer.provideMerge(
      Backend.layer({
        kind: options.backend?.kind ?? 'server',
        userData: options.userData,
      }),
    ),
    Layer.provideMerge(AccountService.layer(options.userData)),
    Layer.provideMerge(KeyStore.layer(options.userData)),
    Layer.provide(
      Layer.mergeAll(
        GitHub.layer.pipe(Layer.provide(GithubTransport.layer)),
        UtilityQueue.layer,
        Turns.layer,
        Terminals.layer,
        layerStore(options.userData).pipe(
          Layer.provideMerge(layerCapabilities(options.browserView)),
        ),
      ).pipe(Layer.provideMerge(Run.layer)),
    ),
    Layer.provideMerge(NodeHttpServer.layerHttpServices),
  );
};

/** Remote access learns Core's bound address (and its certificate under TLS), for the tunnels its devices open into Core. */
const layerBindCore = (token: string, ca: Buffer | undefined) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const { address } = yield* HttpServer.HttpServer;
      const remote = yield* Remote;
      if (!NetAddress.isInetAddress(address)) return;
      // Bound to every interface: loopback is one of them.
      const host = NetAddress.isUnspecified(address.address)
        ? '127.0.0.1'
        : NetAddress.formatUrlHost(address.address);
      remote.bindCore({
        url: `${ca ? 'wss' : 'ws'}://${host}:${address.port}/ws?v=${Contract.PROTOCOL_VERSION}`,
        token,
        ...(ca && { ca }),
      });
    }),
  );

const layerCapabilities = (browserView: LocalCapability | undefined) =>
  Layer.effect(
    Capabilities,
    Effect.tap(Capabilities.make, (capabilities) =>
      browserView
        ? capabilities.serveLocally('browserView', browserView)
        : Effect.void,
    ),
  );

/** The store, its projection and Core's own dispatch, after the one-time import of main's JSON files, so neither reads it before they are in. */
const layerStore = (userData: string | undefined) =>
  Commands.layer.pipe(
    Layer.provide(AgentCaller.layer),
    Layer.provideMerge(Projection.layer(userData)),
    Layer.provideMerge(
      Layer.effectDiscard(
        userData ? Effect.asVoid(importJson(userData)) : Effect.void,
      ),
    ),
    Layer.provideMerge(
      Store.layer(userData ? path.join(userData, 'mochi.db') : ':memory:'),
    ),
    Layer.orDie,
  );

type Services =
  | Backend
  | Run
  | Capabilities
  | UtilityQueue
  | Watch
  | GitHub
  | Store
  | Projection
  | Commands
  | Metrics
  | Terminals
  | Scheduler
  | Hosted
  | AccountService
  | KeyStore
  | Remote;

const layerRoute = (options: ServerOptions) =>
  HttpRouter.serve(
    Layer.mergeAll(
      Layer.unwrap(
        Effect.map(Effect.context<Services>(), (services) =>
          HttpRouter.add('GET', '/ws', connect(options, services)),
        ),
      ),
      options.ui
        ? HttpStaticServer.layer({ root: options.ui, spa: true }).pipe(
            Layer.orDie,
          )
        : Layer.empty,
    ),
    { disableLogger: true, disableListenLog: true },
  );

// Modelled on T3 Code's `apps/server/src/ws.ts`: refuse before the upgrade, then one RPC server per socket, so its
// handlers know the connection's scopes and window.
const connect = (options: ServerOptions, services: Context.Context<Services>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://core');
    if (url.searchParams.get('v') !== String(Contract.PROTOCOL_VERSION))
      return yield* refuse(
        426,
        `Core speaks protocol ${Contract.PROTOCOL_VERSION}`,
      );
    // A URL ends up in logs and history; the token travels as a subprotocol (`Contract.subprotocolsFor`).
    if (url.searchParams.has('token'))
      return yield* refuse(401, 'Token in the query string');
    const identity = identify(
      options.tokens,
      Contract.tokenFromSubprotocols(request.headers['sec-websocket-protocol']),
    );
    if (!identity) return yield* refuse(401, 'Unknown token');
    const origin = request.headers.origin;
    if (origin !== undefined && !options.origins.includes(origin))
      return yield* refuse(403, `Origin ${origin} not allowed`);
    // Only this computer's own clients act for a window; main hands the id to the windows it trusts.
    if (url.searchParams.has('window') && !identity.scopes.includes('local'))
      return yield* refuse(403, 'A scoped token can’t name a window');
    const window = Number(url.searchParams.get('window'));
    const windowId =
      Number.isInteger(window) && window > 0 ? window : undefined;

    const { protocol, httpEffect } =
      yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    yield* RpcServer.make(CoreWsRpcs, { disableFatalDefects: true }).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.provide(
        Layer.mergeAll(
          layerHandlers(windowId, identity),
          layerScopes(identity.scopes),
        ),
      ),
      Effect.provide(services),
      Effect.forkScoped,
    );
    return yield* httpEffect;
  }).pipe(Effect.provide(RpcSerialization.layerJson));

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * `host.agent.*`, served in Core: the window's id goes to each method first. Results are read through the method's schema, as
 * main's were (`hostHandlers`), so records the adapters make without `v` go out at the current version.
 */
const agentHandlers = (windowId: number | undefined) =>
  Object.fromEntries(
    Object.entries(agent).map(([method, handle]) => {
      const tag = `agent.${method}`;
      const output = Schema.toCodecJson(definitionOf(tag).output);
      return [
        tag,
        (args: ReadonlyArray<unknown>) =>
          Effect.tryPromise({
            try: () =>
              (handle as (...args: unknown[]) => Promise<unknown>)(
                windowId,
                ...args,
              ),
            catch: messageOf,
          }).pipe(
            // A void method's JSON form is null.
            Effect.flatMap((value) =>
              Schema.decodeUnknownEffect(output)(value ?? null).pipe(
                Effect.mapError(messageOf),
              ),
            ),
          ),
      ];
    }),
  );

const refuse = (status: number, reason: string) =>
  Effect.as(
    Effect.logWarning(`Refused a socket: ${reason}`).pipe(
      Effect.annotateLogs({ source: 'core' }),
    ),
    HttpServerResponse.text(reason, { status }),
  );

const digest = (token: string) => createHash('sha256').update(token).digest();

interface Identity {
  readonly scopes: ReadonlyArray<Contract.AuthScope>;
  /** Set for a paired device's tunnel. */
  readonly device?: DeviceGrant;
}

/** A known token's scopes, or a device token signed by a `local` one. Digests are compared, so nothing leaks through timing. */
function identify(
  tokens: ServerOptions['tokens'],
  token: string | undefined,
): Identity | undefined {
  if (!token) return undefined;
  const given = digest(token);
  let scopes: ReadonlyArray<Contract.AuthScope> | undefined;
  for (const [known, granted] of tokens)
    if (timingSafeEqual(digest(known), given)) scopes = granted;
  if (scopes) return { scopes };
  for (const [known, granted] of tokens) {
    const device = granted.includes('local')
      ? verifyDeviceToken(known, token)
      : undefined;
    if (device) return { scopes: device.scopes, device };
  }
  return undefined;
}

// Pattern from T3 Code's `apps/server/src/auth/RpcAuthorization.ts`.
const layerScopes = (scopes: ReadonlyArray<Contract.AuthScope>) =>
  Layer.succeed(ScopeAuthorization)((effect, { rpc, payload }) => {
    const missing = refusal(scopes, rpc._tag, payload);
    return missing ? Effect.fail(missing) : effect;
  });

/** Why a connection holding `scopes` may not call `tag`, or undefined when it may: the one decision for windows and devices alike. */
export const refusal = (
  scopes: ReadonlyArray<Contract.AuthScope>,
  tag: string,
  payload?: unknown,
) => {
  const scope = scopeOf(tag, payload);
  return scopes.includes(scope) ? undefined : new Unauthorized({ scope });
};

const layerHandlers = (windowId: number | undefined, identity: Identity) =>
  CoreWsRpcs.toLayer(
    Effect.gen(function* () {
      const run = yield* Run;
      const capabilities = yield* Capabilities;
      const store = yield* Store;
      const queue = yield* UtilityQueue;
      const host = hostHandlers(capabilities, windowId) as Record<
        string,
        (args: ReadonlyArray<unknown>) => Effect.Effect<unknown, string>
      >;
      const watch = yield* Watch;
      const github = yield* GitHub;
      const projection = yield* Projection;
      const commands = yield* Commands;
      const stored = storeHandlers(store, projection);
      const metrics = yield* Metrics;
      const terminals = yield* Terminals;
      const scheduler = yield* Scheduler;
      const hosted = yield* (yield* Hosted).handlers(windowId);
      const backend = yield* Backend;
      const account = yield* AccountService;
      const remote = yield* Remote;
      // Main's connection names no window; what these hand out stays off pages and devices.
      const mainOnly = <A>(run: () => Promise<A>) =>
        windowId === undefined && !identity.device
          ? Effect.tryPromise({ try: run, catch: messageOf })
          : Effect.fail('Only main may ask for this');
      const handlers: Record<string, (payload: never) => unknown> = {
        ping: () => Effect.succeed('pong'),
        'backend.info': () => backend.describe(identity.scopes),
        'backend.watch': () => backend.watch(identity.scopes),
        'backend.identify': (patch: { id?: string; name?: string }) =>
          backend.identify(patch),
        ticks: ({ intervalMs }: { intervalMs: number }) =>
          Stream.fromSchedule(Schedule.spaced(intervalMs)),
        log: ({
          level,
          source,
          message,
        }: {
          level: 'Debug' | 'Info' | 'Warn' | 'Error';
          source: string;
          message: string;
        }) =>
          Effect.logWithLevel(level)(message).pipe(
            Effect.annotateLogs({ source }),
          ),
        run: ({
          command,
          args,
          timeoutMs,
          ...options
        }: {
          command: string;
          args: ReadonlyArray<string>;
          timeoutMs?: number;
        }) =>
          run
            .run(command, args, { ...options, timeout: timeoutMs })
            .pipe(Effect.mapError(asRunError(command))),
        spawn: ({
          command,
          args,
          timeoutMs,
          ...options
        }: {
          command: string;
          args: ReadonlyArray<string>;
          timeoutMs?: number;
        }) => run.spawn(command, args, { ...options, timeout: timeoutMs }),
        stdin: ({ id, data }: { id: number; data: Uint8Array | null }) =>
          run.write(id, data),
        signal: ({ id, signal }: { id: number; signal: string }) =>
          run.signal(id, signal as NodeJS.Signals),
        'capabilities.serve': ({
          names,
        }: {
          names: ReadonlyArray<Contract.CapabilityName>;
        }) => capabilities.serve(names),
        'capabilities.reply': (reply: Contract.CapabilityReply) =>
          capabilities.reply(reply),
        watch: ({ key }: { key: WatchKey }) => watch.watch(key),
        'watch.gate': (gate: Gate) => watch.setGate(gate),
        'account.relayToken': () => mainOnly(() => account.accessToken()),
        'remote.deviceKey': () => mainOnly(() => remote.deviceKey()),
        'remote.paired': () => mainOnly(() => remote.paired()),
        'remote.absorb': ({ members }: { members?: unknown }) =>
          mainOnly(() => remote.absorb(members)),
        'remote.noteWelcome': ({
          machineId,
          ...welcome
        }: {
          machineId: string;
          addresses?: ReadonlyArray<string>;
          kind?: Relay.DeviceKind;
        }) =>
          mainOnly(async () =>
            remote.noteWelcome(machineId, {
              ...welcome,
              addresses: welcome.addresses && [...welcome.addresses],
            }),
          ),
        'remote.joinAlone': () =>
          windowId === undefined && !identity.device
            ? Stream.callback<JoinProgress>((queue) =>
                Effect.acquireRelease(
                  Effect.promise(() =>
                    remote.joinAlone((progress) => {
                      Queue.offerUnsafe(queue, progress);
                      if (isJoinDone(progress)) Queue.endUnsafe(queue);
                    }),
                  ),
                  (off) => Effect.sync(off),
                ),
              )
            : Stream.fail('Only main may ask for this'),
        'remote.shell': (shell: Parameters<typeof remote.setShell>[0]) =>
          mainOnly(async () => remote.setShell(shell)),
        'watch.stale': ({ kinds }: { kinds: ReadonlyArray<StaleKind> }) =>
          watch.markStale(kinds),
        'utility.run': ({
          task,
          spaceId,
          prompt,
          thread,
        }: {
          task: Exclude<keyof typeof PRIORITY, 'classify'>;
          spaceId: string;
          prompt: string;
          thread?: string;
        }) =>
          queue.submit({
            thread,
            kind: task,
            priority: PRIORITY[task],
            promptChars: prompt.length,
            run: utilityCall(task, spaceId, prompt),
          }),
        'utility.classify': ({
          prompt,
          thread,
        }: {
          prompt: string;
          thread: Parameters<typeof classify>[1];
        }) =>
          queue
            .submit({
              thread: thread.id,
              kind: 'classify',
              priority: PRIORITY.classify,
              promptChars: prompt.length,
              run: Effect.tryPromise(() => classify(prompt, thread)).pipe(
                Effect.map((verdict) => JSON.stringify(verdict)),
                Effect.catch((error) =>
                  Effect.as(
                    Effect.logWarning(`classify failed: ${error}`).pipe(
                      Effect.annotateLogs({ source: 'core' }),
                    ),
                    null,
                  ),
                ),
              ),
            })
            .pipe(Effect.map((answer) => (answer ? JSON.parse(answer) : null))),
        metrics: () => metrics.stream,
        'terminal.open': ({
          terminalId,
          threadId,
        }: {
          terminalId: string;
          threadId: string;
        }) => terminals.open(terminalId, threadId),
        'terminal.feed': ({
          terminalId,
          data,
        }: {
          terminalId: string;
          data: string;
        }) => terminals.feed(terminalId, data),
        'terminal.exit': ({
          terminalId,
          exitCode,
        }: {
          terminalId: string;
          exitCode: number;
        }) => terminals.exit(terminalId, exitCode),
        'terminal.close': ({ terminalId }: { terminalId: string }) =>
          terminals.close(terminalId),
        'terminal.watched': ({ terminalId }: { terminalId: string }) =>
          terminals.watched(terminalId),
        'terminal.output': ({
          terminalId,
          threadId,
          after,
        }: {
          terminalId: string;
          threadId: string;
          after: number;
        }) => terminals.output(terminalId, threadId, after),
        ...host,
        ...hosted,
        ...scheduleHandlers(scheduler),
        ...scheduleRpcHandlers(scheduler),
        ...agentHandlers(windowId),
        ...agentRpcHandlers,
        ...stored,
        replica: (input: { afterSequence: number }) =>
          visibleReplica(stored.replica, input, identity.scopes),
        thread: (input: { threadId: string; afterSequence: number }) =>
          stored.thread(input).pipe(
            Stream.map((item) => visibleItem(item, identity.scopes)),
            Stream.filter((item) => item !== undefined),
          ),
        'device.command': ({ command }: { command: Relay.RemoteCommand }) =>
          deviceCommand(
            capabilities,
            commands,
            projection,
            identity.device,
            command,
            ({ tag, payload }) =>
              (
                handlers[tag] as (
                  payload: unknown,
                ) => Effect.Effect<unknown, unknown>
              )(payload),
          ),
        // Main's settings writes land here; the agents read them without a restart.
        'docs.set': (input: {
          table: DocTable;
          key: string;
          value?: unknown;
        }) =>
          stored['docs.set'](input).pipe(
            Effect.tap(() =>
              Effect.sync(
                () =>
                  input.table === 'settings' &&
                  input.key === 'agent' &&
                  agentSettingsSaved(input.value),
              ),
            ),
          ),
        ...githubHandlers(github),
      };
      return handlers as never;
    }),
  );

/** How long a connection without `code` waits for the store to settle before it gets the next snapshot. */
const REPLICA_SETTLE = '500 millis';

type Replica = ReturnType<ReturnType<typeof storeHandlers>['replica']>;

/**
 * The store as `scopes` may see it. With `code`, the window's stream (without `context` for a device). Without it, events
 * may carry diffs (agent patches, checkpoints), so each burst of them becomes a fresh filtered snapshot instead.
 */
const visibleReplica = (
  replica: (input: { afterSequence: number }) => Replica,
  input: { afterSequence: number },
  scopes: ReadonlyArray<Contract.AuthScope>,
): Replica => {
  const visible = Stream.map((item: Stream.Success<Replica>) =>
    item._tag === 'snapshot' ? visibleSnapshot(item, scopes) : item,
  );
  if (scopes.includes('code')) return replica(input).pipe(visible);
  // Checkpoints are diffs: without `code` a snapshot is whole without its parts (`visibleSnapshot`).
  const withoutParts = () =>
    replica({ afterSequence: 0 }).pipe(
      Stream.filter((item) => item._tag !== 'checkpoints'),
    );
  const snapshot = withoutParts().pipe(Stream.take(1));
  return withoutParts().pipe(
    Stream.groupedWithin(Number.MAX_SAFE_INTEGER, REPLICA_SETTLE),
    Stream.flatMap((burst) =>
      burst.at(-1)?._tag === 'snapshot' ? Stream.make(burst.at(-1)!) : snapshot,
    ),
    visible,
  );
};

/**
 * A device's command, an adapter until devices call RPCs themselves: one that is a single RPC runs that RPC's own handler
 * (`directCall`); Core applies one that is store actions itself (`storeCommand`); one that needs a window's host (a diff, a
 * terminal, a push) runs in a window, through main's `remote` capability.
 */
const deviceCommand = (
  capabilities: Capabilities['Service'],
  commands: Commands['Service'],
  projection: Projection['Service'],
  device: DeviceGrant | undefined,
  command: Relay.RemoteCommand,
  call: (direct: DirectCall) => Effect.Effect<unknown, unknown>,
) =>
  Effect.gen(function* () {
    if (!device)
      return {
        isOk: false,
        error: 'Only a paired device sends device commands',
      } satisfies Relay.CommandResult;
    const direct = directCall(command);
    if (direct) {
      const { threadId } = command as { threadId: string };
      const { threads } = (yield* projection.current)
        .domain as unknown as State;
      if (!threads.some((t) => t.id === threadId))
        return { isOk: false, error: 'No such thread on this machine' };
      if (
        command.type === 'schedule' &&
        !(
          (yield* call({
            tag: 'schedule.list',
            payload: [],
          })) as ReadonlyArray<{ threadId: string }>
        ).some((t) => t.threadId === threadId)
      )
        return { isOk: false, error: 'This thread has no schedule' };
      yield* call(direct);
      return { isOk: true } satisfies Relay.CommandResult;
    }
    // Decoded (`Relay.RemoteCommand`), so the store's mutable `RemoteCommand` shape, readonly.
    const stored = storeCommand(
      command as RemoteCommand,
      (yield* projection.current).domain as unknown as State,
      device.name,
    );
    if (!stored) return yield* inWindow(capabilities, device, command);
    for (const action of stored.actions) yield* commands.apply(action);
    const late = stored.verdict;
    if (late)
      yield* Effect.forkDetach(
        Effect.promise(() => late.verdict).pipe(
          Effect.flatMap((v) =>
            v.kind === 'off-goal'
              ? Effect.void
              : commands.apply({
                  type: 'drift-verdict',
                  threadId: late.threadId,
                  text: late.text,
                  drift: v.kind,
                  reason: v.reason,
                }),
          ),
        ),
      );
    return stored.result as Relay.CommandResult;
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed<Relay.CommandResult>({
        isOk: false,
        error: typeof error === 'string' ? error : String(error),
      }),
    ),
  );

const inWindow = (
  capabilities: Capabilities['Service'],
  device: DeviceGrant,
  command: Relay.RemoteCommand,
) =>
  Effect.gen(function* () {
    const request = yield* Schema.encodeEffect(
      Schema.toCodecJson(Relay.RemoteCommandRequest),
    )({ id: device.id, deviceName: device.name, command });
    const value = yield* capabilities.call({
      capability: 'remote',
      method: 'run',
      args: [request],
    });
    return yield* Schema.decodeUnknownEffect(
      Schema.toCodecJson(Relay.CommandResult),
    )(value);
  }).pipe(
    // No desktop app or browser tab holds the store to run it in.
    Effect.catchTag('CapabilityUnavailable', () =>
      Effect.succeed<Relay.CommandResult>({
        isOk: false,
        error: 'No interface is open on this computer',
      }),
    ),
  );
