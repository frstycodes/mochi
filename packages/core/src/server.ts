import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { Context, Effect, Layer, Schedule, Schema, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { RpcSerialization, RpcServer } from 'effect/rpc';
import { NodeHttpServer } from '@effect/platform-node';
import { Capabilities as Contract, definitionOf, Relay } from '@mochi/schema';
import { Cache } from './cache.ts';
import { GitHub, GithubTransport } from './github/service.ts';
import { githubHandlers } from './github/handlers.ts';
import { Capabilities, hostHandlers } from './hostServer.ts';
import { Metrics } from './metrics/metrics.ts';
import { CoreWsRpcs, ScopeAuthorization, Unauthorized } from './rpc.ts';
import { verifyDeviceToken, type DeviceGrant } from './remote/token.ts';
import { visibleItem } from './remote/visible.ts';
import { asRunError, Run } from './run.ts';
import { storeHandlers } from './store/handlers.ts';
import type { DocTable } from './store/migrations.ts';
import { importJson } from './store/importJson.ts';
import { Store } from './store/store.ts';
import { layerReactor } from './reactor/execute.ts';
import { PRIORITY, UtilityQueue } from './utility/queue.ts';
import type { Gate, StaleKind, WatchKey } from './watch/keys.ts';
import { Watch } from './watch/watch.ts';
import { agent, classify, utilityCall } from './agents/handlers.ts';
import { agentRpcHandlers, agentSettingsSaved, layerAgents } from './agents/layer.ts';
import { Turns } from './agents/turns.ts';

export interface ServerOptions {
  readonly port: number;
  readonly host?: string;
  /** Each accepted token and the scopes a connection made with it gets. One carrying `local` also signs device tokens (`remote/token.ts`). */
  readonly tokens: ReadonlyMap<string, ReadonlyArray<Contract.AuthScope>>;
  /** Page origins allowed to connect. A client that sends no Origin (main, a Node client) needs only the token. */
  readonly origins: ReadonlyArray<string>;
  /** Mochi's data folder: the store's `mochi.db`, and the JSON files it imports once. Unset: an in-memory store (tests). */
  readonly userData?: string;
}

/** Everything Core runs, serving RPC on `ws://<host>:<port>/ws`. The `HttpServer` is exposed so tests can read the bound port. */
export const layerCore = (options: ServerOptions) =>
  Layer.mergeAll(layerRoute(options), Cache.layer, layerReactor).pipe(
    Layer.provide(Metrics.layer),
    Layer.provide(Watch.layer),
    Layer.provideMerge(layerAgents(options.userData)),
    Layer.provide(Layer.mergeAll(GitHub.layer.pipe(Layer.provide(GithubTransport.layer)), Capabilities.layer, UtilityQueue.layer, Turns.layer, layerStore(options.userData)).pipe(Layer.provideMerge(Run.layer))),
    // Sockets are long-lived and never drain on their own, so closing waits only briefly for them.
    Layer.provideMerge(
      NodeHttpServer.layer(createServer, {
        port: options.port,
        host: options.host ?? '127.0.0.1',
        gracefulShutdownTimeout: '100 millis',
        // Answers with `mochi` alone: the token subprotocol is never echoed back.
        websocket: { handleProtocols: (offered) => (offered.has(Contract.SUBPROTOCOL) ? Contract.SUBPROTOCOL : false) },
      }),
    ),
  );

/** The store, after the one-time import of main's JSON files, so no handler reads it before they are in. */
const layerStore = (userData: string | undefined) =>
  Layer.effectDiscard(userData ? Effect.asVoid(importJson(userData)) : Effect.void).pipe(
    Layer.provideMerge(Store.layer(userData ? path.join(userData, 'mochi.db') : ':memory:')),
    Layer.orDie,
  );

type Services = Run | Capabilities | UtilityQueue | Watch | GitHub | Store | Metrics;

const layerRoute = (options: ServerOptions) =>
  HttpRouter.serve(
    Layer.unwrap(Effect.map(Effect.context<Services>(), (services) => HttpRouter.add('GET', '/ws', connect(options, services)))),
    { disableLogger: true, disableListenLog: true },
  );

// Modelled on T3 Code's `apps/server/src/ws.ts`: refuse before the upgrade, then one RPC server per socket, so its
// handlers know the connection's scopes and window.
const connect = (options: ServerOptions, services: Context.Context<Services>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://core');
    if (url.searchParams.get('v') !== String(Contract.PROTOCOL_VERSION)) return yield* refuse(426, `Core speaks protocol ${Contract.PROTOCOL_VERSION}`);
    // A URL ends up in logs and history; the token travels as a subprotocol (`Contract.subprotocolsFor`).
    if (url.searchParams.has('token')) return yield* refuse(401, 'Token in the query string');
    const identity = identify(options.tokens, Contract.tokenFromSubprotocols(request.headers['sec-websocket-protocol']));
    if (!identity) return yield* refuse(401, 'Unknown token');
    const origin = request.headers.origin;
    if (origin !== undefined && !options.origins.includes(origin)) return yield* refuse(403, `Origin ${origin} not allowed`);
    // Only this computer's own clients act for a window; main hands the id to the windows it trusts.
    if (url.searchParams.has('window') && !identity.scopes.includes('local')) return yield* refuse(403, 'A scoped token can’t name a window');
    const window = Number(url.searchParams.get('window'));
    const windowId = Number.isInteger(window) && window > 0 ? window : undefined;

    const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    yield* RpcServer.make(CoreWsRpcs, { disableFatalDefects: true }).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.provide(Layer.mergeAll(layerHandlers(windowId, identity, options.userData), layerScopes(identity.scopes))),
      Effect.provide(services),
      Effect.forkScoped,
    );
    return yield* httpEffect;
  }).pipe(Effect.provide(RpcSerialization.layerJson));

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
          Effect.tryPromise({ try: () => (handle as (...args: unknown[]) => Promise<unknown>)(windowId, ...args), catch: messageOf }).pipe(
            // A void method's JSON form is null.
            Effect.flatMap((value) => Schema.decodeUnknownEffect(output)(value ?? null).pipe(Effect.mapError(messageOf))),
          ),
      ];
    }),
  );

const refuse = (status: number, reason: string) =>
  Effect.as(Effect.logWarning(`Refused a socket: ${reason}`).pipe(Effect.annotateLogs({ source: 'core' })), HttpServerResponse.text(reason, { status }));

const digest = (token: string) => createHash('sha256').update(token).digest();

interface Identity {
  readonly scopes: ReadonlyArray<Contract.AuthScope>;
  /** Set for a paired device's tunnel. */
  readonly device?: DeviceGrant;
}

/** A known token's scopes, or a device token signed by a `local` one. Digests are compared, so nothing leaks through timing. */
function identify(tokens: ServerOptions['tokens'], token: string | undefined): Identity | undefined {
  if (!token) return undefined;
  const given = digest(token);
  let scopes: ReadonlyArray<Contract.AuthScope> | undefined;
  for (const [known, granted] of tokens) if (timingSafeEqual(digest(known), given)) scopes = granted;
  if (scopes) return { scopes };
  for (const [known, granted] of tokens) {
    const device = granted.includes('local') ? verifyDeviceToken(known, token) : undefined;
    if (device) return { scopes: device.scopes, device };
  }
  return undefined;
}

// Pattern from T3 Code's `apps/server/src/auth/RpcAuthorization.ts`.
const layerScopes = (scopes: ReadonlyArray<Contract.AuthScope>) =>
  Layer.succeed(ScopeAuthorization)((effect, { rpc, payload }) => {
    const scope = Contract.scopeOf(rpc._tag, payload);
    return scopes.includes(scope) ? effect : Effect.fail(new Unauthorized({ scope }));
  });

const layerHandlers = (windowId: number | undefined, identity: Identity, userData: string | undefined) =>
  CoreWsRpcs.toLayer(
    Effect.gen(function* () {
      const run = yield* Run;
      const capabilities = yield* Capabilities;
      const store = yield* Store;
      const queue = yield* UtilityQueue;
      const host = hostHandlers(capabilities, windowId) as Record<string, (args: ReadonlyArray<unknown>) => Effect.Effect<unknown, string>>;
      const watch = yield* Watch;
      const github = yield* GitHub;
      const stored = storeHandlers(store, userData);
      const metrics = yield* Metrics;
      return {
        ping: () => Effect.succeed('pong'),
        ticks: ({ intervalMs }: { intervalMs: number }) => Stream.fromSchedule(Schedule.spaced(intervalMs)),
        log: ({ level, source, message }: { level: 'Debug' | 'Info' | 'Warn' | 'Error'; source: string; message: string }) =>
          Effect.logWithLevel(level)(message).pipe(Effect.annotateLogs({ source })),
        run: ({ command, args, timeoutMs, ...options }: { command: string; args: ReadonlyArray<string>; timeoutMs?: number }) =>
          run.run(command, args, { ...options, timeout: timeoutMs }).pipe(Effect.mapError(asRunError(command))),
        spawn: ({ command, args, timeoutMs, ...options }: { command: string; args: ReadonlyArray<string>; timeoutMs?: number }) =>
          run.spawn(command, args, { ...options, timeout: timeoutMs }),
        stdin: ({ id, data }: { id: number; data: Uint8Array | null }) => run.write(id, data),
        signal: ({ id, signal }: { id: number; signal: string }) => run.signal(id, signal as NodeJS.Signals),
        'capabilities.serve': ({ names }: { names: ReadonlyArray<Contract.CapabilityName> }) => capabilities.serve(names),
        'capabilities.reply': (reply: Contract.CapabilityReply) => capabilities.reply(reply),
        watch: ({ key }: { key: WatchKey }) => watch.watch(key),
        'watch.gate': (gate: Gate) => watch.setGate(gate),
        'watch.stale': ({ kinds }: { kinds: ReadonlyArray<StaleKind> }) => watch.markStale(kinds),
        'utility.run': ({ task, spaceId, prompt, thread }: { task: Exclude<keyof typeof PRIORITY, 'classify'>; spaceId: string; prompt: string; thread?: string }) =>
          queue.submit({ thread, kind: task, priority: PRIORITY[task], promptChars: prompt.length, run: utilityCall(task, spaceId, prompt) }),
        'utility.classify': ({ prompt, thread }: { prompt: string; thread: Parameters<typeof classify>[1] }) =>
          queue.submit({
            thread: thread.id,
            kind: 'classify',
            priority: PRIORITY.classify,
            promptChars: prompt.length,
            run: Effect.tryPromise(() => classify(prompt, thread)).pipe(
              Effect.map((verdict) => JSON.stringify(verdict)),
              Effect.catch((error) => Effect.as(Effect.logWarning(`classify failed: ${error}`).pipe(Effect.annotateLogs({ source: 'core' })), null)),
            ),
          }).pipe(Effect.map((answer) => (answer ? JSON.parse(answer) : null))),
        metrics: () => metrics.stream,
        ...host,
        ...agentHandlers(windowId),
        ...agentRpcHandlers,
        ...stored,
        thread: (input: { threadId: string; afterSequence: number }) => stored.thread(input).pipe(Stream.map((item) => visibleItem(item, identity.scopes)), Stream.filter((item) => item !== undefined)),
        'device.command': ({ command }: { command: Relay.RemoteCommand }) => deviceCommand(capabilities, identity.device, command),
        // Main's settings writes land here; the agents read them without a restart.
        'docs.set': (input: { table: DocTable; key: string; value?: unknown }) =>
          stored['docs.set'](input).pipe(Effect.tap(() => Effect.sync(() => input.table === 'settings' && input.key === 'agent' && agentSettingsSaved(input.value)))),
        ...githubHandlers(github),
      } as never;
    }),
  );

/** Runs in the window that owns the store, through main's `remote` capability, until Core owns the store. */
const deviceCommand = (capabilities: Capabilities['Service'], device: DeviceGrant | undefined, command: Relay.RemoteCommand) =>
  Effect.gen(function* () {
    if (!device) return { isOk: false, error: 'Only a paired device sends device commands' } satisfies Relay.CommandResult;
    const request = yield* Schema.encodeEffect(Schema.toCodecJson(Relay.RemoteCommandRequest))({ id: device.id, deviceName: device.name, command });
    const value = yield* capabilities.call({ capability: 'remote', method: 'run', args: [request] });
    return yield* Schema.decodeUnknownEffect(Schema.toCodecJson(Relay.CommandResult))(value);
  }).pipe(Effect.catch((error) => Effect.succeed<Relay.CommandResult>({ isOk: false, error: typeof error === 'string' ? error : String(error) })));
