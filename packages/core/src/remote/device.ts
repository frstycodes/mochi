import { Effect, Layer, Schedule, Schema } from 'effect';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { Socket } from 'effect/socket';
import WebSocket from 'ws';
import { Relay } from '@mochi/schema';
import { CoreWsRpcs } from '../rpc.ts';
import { keepAlive, socketLink, type Link, type RawLink } from './link.ts';
import { backoff, onNetworkChange } from './reconnect.ts';

/** One way to reach a machine: a LAN or Tailscale address (`lan`), or the relay. */
export interface Route {
  kind: 'lan' | 'relay';
  open(): Promise<RawLink>;
}

/** Every way to reach it on one attempt: the direct ones are dialled together, the relay a little later. */
export interface Routes {
  direct: Route[];
  relay?: Route;
  /** The relay saw both computers at one public address: the same site, so direct gets longer before the relay starts. */
  isSameSite?: boolean;
}

export interface DeviceOptions {
  /** Read on every attempt: addresses and the account change between them. */
  routes: () => Routes | Promise<Routes>;
  /** The pairing exchange as a returning device; every route runs it, direct ones included. */
  secure: (raw: RawLink) => Promise<Link>;
  /** Only a refusal through the relay is final: an address on the LAN may since belong to another computer. */
  isRefusal: (error: unknown) => boolean;
  /** This computer's membership records, sent in each hello. */
  members?: () => unknown;
  onWelcome: (welcome: Relay.WelcomeFrame, route: Route['kind']) => void;
  onMembers?: (members: unknown) => void;
  /** Why it isn't connected now; the client redials after `backoff`. */
  onOffline: (error: string) => void;
  /** The machine refused this computer; nothing retries until the caller starts over. */
  onRefused: (reason: string) => void;
}

const WELCOME_TIMEOUT_MS = 15_000;
const LAN_TIMEOUT_MS = 2000;
/** How long one route has to open and finish the pairing exchange. */
const ATTEMPT_TIMEOUT_MS = 15_000;
/** The head start direct routes get before the relay is dialled too; longer on the same site. */
export const RELAY_DELAY_MS = 1500;
export const SAME_SITE_RELAY_DELAY_MS = 4000;
/** How often a session on the relay looks for a direct route (and on every network change). */
const PROBE_MS = 30_000;
/** How long a move to a direct route waits for calls in flight on the relay to finish. */
const DRAIN_MS = 10_000;
/** A dropped link reports offline only if no route came back in this long, so a move or a quick redial never shows. */
const OFFLINE_GRACE_MS = 4000;

/** One device client's connection across redials and moves between routes. */
interface Dial {
  attempts: number;
  /** A direct link already paired and welcomed, which the next `open` takes instead of dialling. */
  next?: { link: Link; welcome: Relay.WelcomeFrame; route: Route['kind'] };
  offline?: ReturnType<typeof setTimeout>;
}

/** A machine's Core as an RPC client, through whichever route pairs first, redialled on the same schedule for every route. */
export const makeDeviceClient = (options: DeviceOptions) =>
  Effect.flatMap(Layer.build(layerProtocol(options)), (context) =>
    RpcClient.make(CoreWsRpcs).pipe(Effect.provide(context)),
  );

export type DeviceClient = Effect.Success<ReturnType<typeof makeDeviceClient>>;

/**
 * The protocol redials at once (`Schedule.forever`); the wait is `open`'s own, so a network change cuts it short and a
 * welcome starts it over. Effect's schedule would keep growing across connections and can't be woken.
 */
const layerProtocol = (options: DeviceOptions) =>
  RpcClient.layerProtocolSocket({
    retryTransientErrors: true,
    retryPolicy: Schedule.forever,
  }).pipe(
    Layer.provide(
      Layer.effect(
        Socket.Socket,
        Effect.sync(() => {
          const dial: Dial = { attempts: 0 };
          return Socket.fromWebSocket(
            Effect.acquireRelease(open(options, dial), (ws) =>
              Effect.sync(() => ws.close(1000, 'Done')),
            ),
          );
        }).pipe(Effect.flatten),
      ),
    ),
    Layer.provide(RpcSerialization.layerJson),
  );

const decodeMachineFrame = Schema.decodeUnknownOption(
  Schema.fromJsonString(Relay.MachineLinkFrame),
);

/**
 * Takes a direct link a probe already paired, or waits out the backoff after a failed or dropped connection and dials every
 * route; says hello and waits for the welcome; then the link is the RPC socket. A welcome makes the next wait the shortest.
 */
const open = (options: DeviceOptions, dial: Dial) =>
  Effect.suspend(() =>
    dial.next || dial.attempts++ === 0
      ? Effect.void
      : backoff(dial.attempts - 1),
  ).pipe(
    Effect.andThen(
      Effect.tryPromise({
        try: async () => {
          const ready = dial.next;
          dial.next = undefined;
          if (ready?.link.isOpen()) return connected(ready, options, dial);
          const { link, route } = await dialFirst(
            await options.routes(),
            options,
          );
          const welcome = await hello(link, options);
          return connected({ link, welcome, route }, options, dial);
        },
        catch: (cause) => {
          clearTimeout(dial.offline);
          options.onOffline(
            cause instanceof Error ? cause.message : String(cause),
          );
          return new Socket.SocketError({
            reason: new Socket.SocketOpenError({ kind: 'Unknown', cause }),
          });
        },
      }),
    ),
  );

function connected(
  { link, welcome, route }: NonNullable<Dial['next']>,
  options: DeviceOptions,
  dial: Dial,
) {
  dial.attempts = 1;
  clearTimeout(dial.offline);
  options.onWelcome(welcome, route);
  const socket = linkSocket(link, options, dial);
  if (route === 'relay') lookForDirect(socket, options, dial);
  return socket;
}

/**
 * Dials every direct route at once and the relay after `RELAY_DELAY_MS` (sooner once every direct one failed), and takes the
 * first that finishes the pairing exchange; the others are closed as they answer. Rejects when all failed, or at once when
 * the relay refused this computer.
 */
export function dialFirst(
  routes: Routes,
  options: Pick<DeviceOptions, 'secure' | 'isRefusal' | 'onRefused'>,
  { hasRelay = true } = {},
): Promise<{ link: Link; route: Route['kind'] }> {
  const relay = hasRelay ? routes.relay : undefined;
  return new Promise((resolve, reject) => {
    let isDone = false;
    let isRelayDialled = !relay;
    let pending = 0;
    let lastError: unknown = new Error('No way to reach it');
    const finish = () => {
      if (!isDone && pending === 0 && isRelayDialled) {
        isDone = true;
        reject(lastError);
      }
    };
    const dialRelay = () => {
      clearTimeout(timer);
      if (isRelayDialled) return;
      isRelayDialled = true;
      attempt(relay!);
    };
    function attempt(route: Route) {
      pending++;
      void secured(route, options.secure).then(
        (link) => {
          pending--;
          if (isDone) return link.close(1000, 'Another route answered first');
          isDone = true;
          clearTimeout(timer);
          resolve({ link, route: route.kind });
        },
        (error: unknown) => {
          pending--;
          if (isDone) return;
          if (route.kind === 'relay' && options.isRefusal(error)) {
            isDone = true;
            clearTimeout(timer);
            options.onRefused(
              error instanceof Error ? error.message : String(error),
            );
            return reject(error);
          }
          lastError = error;
          // Every direct route failed: the relay needn't wait out its head start.
          if (route.kind !== 'relay' && pending === 0) dialRelay();
          finish();
        },
      );
    }
    const delay = routes.isSameSite ? SAME_SITE_RELAY_DELAY_MS : RELAY_DELAY_MS;
    const timer = setTimeout(dialRelay, routes.direct.length ? delay : 0);
    routes.direct.forEach(attempt);
    finish();
  });
}

/** One route opened and paired within `ATTEMPT_TIMEOUT_MS`; a link that opened but didn't pair is closed. */
async function secured(route: Route, secure: DeviceOptions['secure']) {
  let raw: RawLink | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('That computer took too long to answer')),
      ATTEMPT_TIMEOUT_MS,
    );
  });
  try {
    raw = await Promise.race([route.open(), timeout]);
    return await Promise.race([secure(raw), timeout]);
  } catch (error) {
    raw?.close(1000, 'Pairing failed');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * While the session rides the relay, looks for a direct route every `PROBE_MS` and on every network change. One that pairs
 * and welcomes waits in `dial.next`; once no call is in flight (or after `DRAIN_MS`) the relay link closes, the protocol
 * redials at once, takes it, and every stream resumes from its last sequence. Nothing is sent twice: a call in flight either
 * finishes on the relay first or fails as a drop.
 */
function lookForDirect(socket: LinkSocket, options: DeviceOptions, dial: Dial) {
  let isProbing = false;
  const probe = async () => {
    if (isProbing || dial.next || !socket.isOpen()) return;
    isProbing = true;
    try {
      const routes = await options.routes();
      if (!routes.direct.length) return;
      const { link, route } = await dialFirst(routes, options, {
        hasRelay: false,
      });
      const welcome = await hello(link, options);
      if (!socket.isOpen()) return link.close(1000, 'No longer needed');
      dial.next = { link, welcome, route };
      link.onClose(() => {
        if (dial.next?.link === link) dial.next = undefined;
      });
      await socket.drained(DRAIN_MS);
      socket.move();
    } catch {
      // No direct route answered; the relay carries on.
    } finally {
      isProbing = false;
    }
  };
  const timer = setInterval(() => void probe(), PROBE_MS);
  const offChange = onNetworkChange(() => void probe());
  socket.onClose(() => {
    clearInterval(timer);
    offChange();
  });
  void probe();
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

type LinkSocket = Socket.WebSocketLike & {
  isOpen(): boolean;
  onClose(listener: () => void): void;
  /** Resolves once no unary call waits for its answer, or after `ms`. */
  drained(ms: number): Promise<void>;
  /** Closes it for a move to `dial.next`: the protocol redials, and nobody is told it went offline. */
  move(): void;
};

// Effect's JSON frames start with their tag and id (`RpcMessage`), so a call is tracked without parsing a snapshot.
const REQUEST = /^\{"_tag":"Request","id":"([^"]+)"/;
const ANSWER = /^\{"_tag":"(?:Chunk|Exit)","requestId":"([^"]+)"/;
const INTERRUPT = /^\{"_tag":"Interrupt","requestId":"([^"]+)"/;

/** The paired link as the WebSocket Effect's socket reads: RPC frames pass through, membership frames go to `onMembers`. */
function linkSocket(
  link: Link,
  options: DeviceOptions,
  dial: Dial,
): LinkSocket {
  const listeners = {
    open: new Set<Listener>(),
    message: new Set<Listener>(),
    error: new Set<Listener>(),
    close: new Set<Listener>(),
  };
  const emit = (type: keyof typeof listeners, event: Parameters<Listener>[0]) =>
    listeners[type].forEach((listener) => listener(event));
  /** Calls sent and not yet answered; a stream leaves once its first chunk arrives. */
  const waiting = new Set<string>();
  let onDrained: (() => void) | undefined;
  const settle = (id: string | undefined) => {
    if (id === undefined || !waiting.delete(id)) return;
    if (!waiting.size) onDrained?.();
  };
  let isMoving = false;
  link.onMessage((text) => {
    const control = text.startsWith('{"type"')
      ? decodeMachineFrame(text)
      : undefined;
    if (control?._tag === 'Some' && control.value.type === 'members')
      return options.onMembers?.(control.value.members);
    settle(ANSWER.exec(text)?.[1]);
    emit('message', { data: text });
  });
  link.onClose(() => {
    if (!isMoving) {
      clearTimeout(dial.offline);
      dial.offline = setTimeout(
        () => options.onOffline('The connection dropped'),
        OFFLINE_GRACE_MS,
      );
    }
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
    send: (data) => {
      const text =
        typeof data === 'string' ? data : new TextDecoder().decode(data);
      const id = REQUEST.exec(text)?.[1];
      if (id !== undefined) waiting.add(id);
      settle(INTERRUPT.exec(text)?.[1]);
      link.send(text);
    },
    isOpen: () => link.isOpen(),
    onClose: (listener) => link.onClose(listener),
    drained: (ms) =>
      new Promise<void>((resolve) => {
        if (!waiting.size) return resolve();
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          onDrained = undefined;
          resolve();
        }
        onDrained = done;
      }),
    move() {
      isMoving = true;
      link.close(1000, 'Moving to a direct connection');
    },
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
