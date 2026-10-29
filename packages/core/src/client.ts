import { Effect, Exit, Layer, Schedule, Scope } from 'effect';
import { RpcClient, RpcClientError, RpcSerialization } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { Capabilities } from '@mochi/schema';
import { CoreWsRpcs } from './rpc.ts';

/**
 * Core's socket. `windowId` is the caller's webContents id, for `host.*` handlers that act on their sender. The token rides
 * in the fragment, which a WebSocket never sends: `makeCoreClient` offers it as a subprotocol.
 */
export const coreUrl = (port: number, token: string, windowId?: number) =>
  `ws://127.0.0.1:${port}/ws?v=${Capabilities.PROTOCOL_VERSION}${windowId ? `&window=${windowId}` : ''}#${token}`;

/** Redials every 250ms while Core is down; calls made meanwhile wait for it. */
const layerProtocol = (
  url: string,
  webSocket: Layer.Layer<Socket.WebSocketConstructor>,
) =>
  RpcClient.layerProtocolSocket({
    retryTransientErrors: true,
    retryPolicy: Schedule.spaced(250),
  }).pipe(
    Layer.provide(
      Socket.layerWebSocket(url.split('#')[0]!, {
        protocols: Capabilities.subprotocolsFor(url.split('#')[1] ?? ''),
      }),
    ),
    Layer.provide(webSocket),
    Layer.provide(RpcSerialization.layerJson),
  );

/**
 * The connection lives as long as the caller's scope. Idempotent calls retry across a Core restart (`retryIdempotent`).
 * `webSocket` is the platform's by default; `mochi login` passes one that trusts only a TLS Core's own certificate.
 */
export const makeCoreClient = (
  url: string,
  webSocket: Layer.Layer<Socket.WebSocketConstructor> = Socket.layerWebSocketConstructorGlobal,
) =>
  Effect.flatMap(Layer.build(layerProtocol(url, webSocket)), (context) =>
    RpcClient.make(CoreWsRpcs).pipe(
      Effect.provide(context),
      Effect.map(retryIdempotent),
    ),
  );

/** Safe to send twice: reads, writes of a whole value, and appends deduplicated by their `commandId`. Streams resubscribe instead. */
const IDEMPOTENT = new Set([
  'ping',
  'log',
  'docs.list',
  'docs.get',
  'docs.set',
  'events.append',
]);

/** A restart drops the socket under calls in flight; Core is back within a few seconds (`RESTART_DELAY_MS` in host.ts). */
const RECONNECT_TRIES = 120;
const isDropped = (error: unknown) =>
  error instanceof RpcClientError.RpcClientError &&
  error.reason._tag.startsWith('Socket');

function retryIdempotent<Client extends object>(client: Client): Client {
  return new Proxy(client, {
    get(target, tag, receiver) {
      const procedure = Reflect.get(target, tag, receiver) as (
        ...args: ReadonlyArray<unknown>
      ) => Effect.Effect<unknown, unknown>;
      if (typeof tag !== 'string' || !IDEMPOTENT.has(tag)) return procedure;
      return (...args: ReadonlyArray<unknown>) =>
        procedure(...args).pipe(
          Effect.retry({
            while: isDropped,
            schedule: Schedule.spaced(250),
            times: RECONNECT_TRIES,
          }),
        );
    },
  });
}

export type CoreClient = Effect.Success<ReturnType<typeof makeCoreClient>>;

/** For callers outside Effect. `close` drops the connection. */
export async function connectCore(url: string) {
  const scope = Scope.makeUnsafe();
  const client = await Effect.runPromise(
    Scope.provide(makeCoreClient(url), scope),
  );
  return {
    client,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}
