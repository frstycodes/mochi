import { Effect, Layer, Schema } from 'effect';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { Socket } from 'effect/socket';
import WebSocket from 'ws';
import { Relay } from '@mochi/schema';
import { CoreWsRpcs } from '../rpc.ts';
import { keepAlive, socketLink, type Link, type RawLink } from './link.ts';
import { reconnect } from './reconnect.ts';

/** One way to reach a machine. LAN and Tailscale addresses come first; the relay last. */
export interface Route {
  kind: 'lan' | 'relay';
  open(): Promise<RawLink>;
}

export interface DeviceOptions {
  /** Read on every attempt: addresses and the account change between them. */
  routes: () => Route[];
  /** The pairing exchange as a returning device. */
  secure: (raw: RawLink) => Promise<Link>;
  /** Only a refusal through the relay is final: an address on the LAN may since belong to another computer. */
  isRefusal: (error: unknown) => boolean;
  /** This computer's membership records, sent in each hello. */
  members?: () => unknown;
  onWelcome: (welcome: Relay.WelcomeFrame, route: Route['kind']) => void;
  onMembers?: (members: unknown) => void;
  /** Why it isn't connected now; the client redials on `reconnect`. */
  onOffline: (error: string) => void;
  /** The machine refused this computer; nothing retries until the caller starts over. */
  onRefused: (reason: string) => void;
}

const WELCOME_TIMEOUT_MS = 15_000;
const LAN_TIMEOUT_MS = 2000;

/** A machine's Core as an RPC client, through whichever route pairs first, redialled on the same schedule for every route. */
export const makeDeviceClient = (options: DeviceOptions) =>
  Effect.flatMap(Layer.build(layerProtocol(options)), (context) =>
    RpcClient.make(CoreWsRpcs).pipe(Effect.provide(context)),
  );

export type DeviceClient = Effect.Success<ReturnType<typeof makeDeviceClient>>;

const layerProtocol = (options: DeviceOptions) =>
  RpcClient.layerProtocolSocket({
    retryTransientErrors: true,
    retryPolicy: reconnect,
  }).pipe(
    Layer.provide(
      Layer.effect(
        Socket.Socket,
        Socket.fromWebSocket(
          Effect.acquireRelease(open(options), (ws) =>
            Effect.sync(() => ws.close(1000, 'Done')),
          ),
        ),
      ),
    ),
    Layer.provide(RpcSerialization.layerJson),
  );

const decodeMachineFrame = Schema.decodeUnknownOption(
  Schema.fromJsonString(Relay.MachineLinkFrame),
);

/** Pairs over the first route that answers, says hello, and waits for the welcome; then the link is the RPC socket. */
const open = (options: DeviceOptions) =>
  Effect.tryPromise({
    try: async () => {
      const { link, route } = await openFirst(options);
      const welcome = await hello(link, options);
      options.onWelcome(welcome, route);
      return linkSocket(link, options);
    },
    catch: (cause) => {
      options.onOffline(cause instanceof Error ? cause.message : String(cause));
      return new Socket.SocketError({
        reason: new Socket.SocketOpenError({ kind: 'Unknown', cause }),
      });
    },
  });

async function openFirst(
  options: DeviceOptions,
): Promise<{ link: Link; route: Route['kind'] }> {
  let error: unknown = new Error('No way to reach it');
  for (const route of options.routes()) {
    let raw: RawLink | undefined;
    try {
      raw = await route.open();
      return { link: await options.secure(raw), route: route.kind };
    } catch (e) {
      raw?.close(1000, 'Pairing failed');
      if (route.kind === 'relay' && options.isRefusal(e)) {
        options.onRefused(e instanceof Error ? e.message : String(e));
        throw e;
      }
      error = e;
    }
  }
  throw error;
}

function hello(link: Link, options: DeviceOptions) {
  return new Promise<Relay.WelcomeFrame>((resolve, reject) => {
    const timer = setTimeout(
      () => fail('That computer didn’t answer'),
      WELCOME_TIMEOUT_MS,
    );
    function fail(reason: string) {
      clearTimeout(timer);
      link.close(1000, reason);
      reject(new Error(reason));
    }
    link.onMessage((text) => {
      const frame = decodeMachineFrame(text);
      if (frame._tag === 'None')
        return fail('That computer answered something unexpected');
      if (frame.value.type === 'members')
        return options.onMembers?.(frame.value.members);
      clearTimeout(timer);
      if (frame.value.type === 'refused') return fail(frame.value.reason);
      resolve(frame.value);
    });
    link.onClose(() => fail('That computer closed the connection'));
    const members = options.members?.();
    link.send(
      JSON.stringify({
        type: 'hello',
        version: Relay.PROTOCOL_VERSION,
        ...(members !== undefined && { members }),
      } satisfies Relay.HelloFrame),
    );
  });
}

type Listener = (event: {
  data?: string;
  code?: number;
  reason?: string;
}) => void;

/** The paired link as the WebSocket Effect's socket reads: RPC frames pass through, membership frames go to `onMembers`. */
function linkSocket(link: Link, options: DeviceOptions): Socket.WebSocketLike {
  const listeners = {
    open: new Set<Listener>(),
    message: new Set<Listener>(),
    error: new Set<Listener>(),
    close: new Set<Listener>(),
  };
  const emit = (type: keyof typeof listeners, event: Parameters<Listener>[0]) =>
    listeners[type].forEach((listener) => listener(event));
  link.onMessage((text) => {
    const control = text.startsWith('{"type"')
      ? decodeMachineFrame(text)
      : undefined;
    if (control?._tag === 'Some' && control.value.type === 'members')
      return options.onMembers?.(control.value.members);
    emit('message', { data: text });
  });
  link.onClose(() => {
    options.onOffline('The connection dropped');
    emit('close', { code: 1006, reason: 'The connection dropped' });
  });
  return {
    get readyState() {
      return link.isOpen() ? 1 : 3;
    },
    addEventListener: (type, listener) =>
      void listeners[type].add(listener as Listener),
    removeEventListener: (type, listener) =>
      void listeners[type].delete(listener as Listener),
    close: (code, reason) => link.close(code ?? 1000, reason ?? ''),
    send: (data) =>
      link.send(
        typeof data === 'string' ? data : new TextDecoder().decode(data),
      ),
  };
}

/** A machine's server on its LAN or Tailscale address, kept alive by WebSocket pings. */
export function openLan(address: string): Promise<RawLink> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${address}`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Nothing answered at ${address}`));
    }, LAN_TIMEOUT_MS);
    ws.on('open', () => {
      clearTimeout(timer);
      keepAlive(ws, () => ws.ping());
      resolve(socketLink(ws));
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
