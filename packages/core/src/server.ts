import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { Context, Effect, Layer, Schedule, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { RpcSerialization, RpcServer } from 'effect/rpc';
import { NodeHttpServer } from '@effect/platform-node';
import { Capabilities as Contract } from '@mochi/schema';
import { Cache } from './cache.ts';
import { Capabilities, hostHandlers } from './hostServer.ts';
import { CoreWsRpcs, ScopeAuthorization, Unauthorized } from './rpc.ts';
import { asRunError, Run } from './run.ts';
import { storeHandlers } from './store/handlers.ts';
import { importJson } from './store/importJson.ts';
import { Store } from './store/store.ts';
import { PRIORITY, UtilityQueue } from './utility/queue.ts';

export interface ServerOptions {
  readonly port: number;
  readonly host?: string;
  /** Each accepted token and the scopes a connection made with it gets. */
  readonly tokens: ReadonlyMap<string, ReadonlyArray<Contract.AuthScope>>;
  /** Page origins allowed to connect. A client that sends no Origin (main, a Node client) needs only the token. */
  readonly origins: ReadonlyArray<string>;
  /** Mochi's data folder: the store's `mochi.db`, and the JSON files it imports once. Unset: an in-memory store (tests). */
  readonly userData?: string;
}

/** Everything Core runs, serving RPC on `ws://<host>:<port>/ws`. The `HttpServer` is exposed so tests can read the bound port. */
export const layerCore = (options: ServerOptions) =>
  Layer.mergeAll(layerRoute(options), Cache.layer).pipe(
    Layer.provide(Layer.mergeAll(Run.layer, Capabilities.layer, UtilityQueue.layer, layerStore(options.userData))),
    // Sockets are long-lived and never drain on their own, so closing waits only briefly for them.
    Layer.provideMerge(NodeHttpServer.layer(createServer, { port: options.port, host: options.host ?? '127.0.0.1', gracefulShutdownTimeout: '100 millis' })),
  );

/** The store, after the one-time import of main's JSON files, so no handler reads it before they are in. */
const layerStore = (userData: string | undefined) =>
  Layer.effectDiscard(userData ? Effect.asVoid(importJson(userData)) : Effect.void).pipe(
    Layer.provideMerge(Store.layer(userData ? path.join(userData, 'mochi.db') : ':memory:')),
    Layer.orDie,
  );

type Services = Run | Capabilities | UtilityQueue | Store;

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
    const scopes = scopesOf(options.tokens, url.searchParams.get('token'));
    if (!scopes) return yield* refuse(401, 'Unknown token');
    const origin = request.headers.origin;
    if (origin !== undefined && !options.origins.includes(origin)) return yield* refuse(403, `Origin ${origin} not allowed`);
    const window = Number(url.searchParams.get('window'));
    const windowId = Number.isInteger(window) && window > 0 ? window : undefined;

    const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    yield* RpcServer.make(CoreWsRpcs, { disableFatalDefects: true }).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.provide(Layer.mergeAll(layerHandlers(windowId, options.userData), layerScopes(scopes))),
      Effect.provide(services),
      Effect.forkScoped,
    );
    return yield* httpEffect;
  }).pipe(Effect.provide(RpcSerialization.layerJson));

const refuse = (status: number, reason: string) =>
  Effect.as(Effect.logWarning(`Refused a socket: ${reason}`).pipe(Effect.annotateLogs({ source: 'core' })), HttpServerResponse.text(reason, { status }));

const digest = (token: string) => createHash('sha256').update(token).digest();

/** Compares digests, so neither the token's length nor its content leaks through timing. */
function scopesOf(tokens: ServerOptions['tokens'], token: string | null) {
  if (!token) return undefined;
  const given = digest(token);
  let scopes: ReadonlyArray<Contract.AuthScope> | undefined;
  for (const [known, granted] of tokens) if (timingSafeEqual(digest(known), given)) scopes = granted;
  return scopes;
}

// Pattern from T3 Code's `apps/server/src/auth/RpcAuthorization.ts`.
const layerScopes = (scopes: ReadonlyArray<Contract.AuthScope>) =>
  Layer.succeed(ScopeAuthorization)((effect, { rpc }) => {
    const scope = Contract.scopeOf(rpc._tag);
    return scopes.includes(scope) ? effect : Effect.fail(new Unauthorized({ scope }));
  });

const layerHandlers = (windowId: number | undefined, userData: string | undefined) =>
  CoreWsRpcs.toLayer(
    Effect.gen(function* () {
      const run = yield* Run;
      const capabilities = yield* Capabilities;
      const store = yield* Store;
      const queue = yield* UtilityQueue;
      const host = hostHandlers(capabilities, windowId) as Record<string, (args: ReadonlyArray<unknown>) => Effect.Effect<unknown, string>>;
      // The model call itself still runs in main (`agent.utility`, `agent.classify` on the `host` capability); Core decides when, and which one.
      const model = (tag: string, args: ReadonlyArray<unknown>) =>
        host[tag]!(args).pipe(Effect.catch((error) => Effect.logWarning(`${tag} failed: ${error}`).pipe(Effect.annotateLogs({ source: 'core' }), Effect.as(null))));
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
        'utility.run': ({ task, spaceId, prompt, thread }: { task: keyof typeof PRIORITY; spaceId: string; prompt: string; thread?: string }) =>
          queue.submit({ thread, kind: task, priority: PRIORITY[task], promptChars: prompt.length, run: model('agent.utility', [task, spaceId, prompt]) as Effect.Effect<string | null> }),
        'utility.classify': ({ prompt, thread }: { prompt: string; thread: { id: string } }) =>
          queue.submit({
            thread: thread.id,
            kind: 'classify',
            priority: PRIORITY.classify,
            promptChars: prompt.length,
            run: Effect.map(model('agent.classify', [prompt, thread]), (verdict) => (verdict ? JSON.stringify(verdict) : null)),
          }).pipe(Effect.map((answer) => (answer ? JSON.parse(answer) : null))),
        ...host,
        ...storeHandlers(store, userData),
      } as never;
    }),
  );
