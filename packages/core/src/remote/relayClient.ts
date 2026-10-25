import { Config, Data, Effect, Fiber, Schema } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';
import { NodeHttpClient } from '@effect/platform-node';
import WebSocket from 'ws';
import { RelayWire, type Remote } from '@mochi/schema';
import {
  HEARTBEAT_MS,
  keepAlive,
  queuedReader,
  socketLink,
  toBytes,
  type RawLink,
} from './link.ts';
import { reconnect } from './reconnect.ts';

const {
  decodeRelayToMachine,
  HEARTBEAT,
  RelayMachine,
  splitChannel,
  withChannel,
} = RelayWire;

/** Mochi's hosted relay (`infra/relay`); `MOCHI_RELAY_URL` points dev runs and self-hosters at another. */
export const RELAY_URL = Effect.runSync(
  Config.String('MOCHI_RELAY_URL').pipe(
    Config.withDefault('https://mochi-relay.sandeshpandey.workers.dev'),
  ),
);

export interface MachineConnection {
  close(): void;
}

/**
 * This machine's one outbound socket to the relay, kept open with backoff. Each device the relay connects becomes a
 * `RawLink` handed to `onChannel`; the bytes on it are the pairing exchange, then ciphertext.
 */
export function connectMachine(options: {
  machineId: string;
  name: () => string;
  publicKey: string;
  token: () => Promise<string>;
  onChannel: (raw: RawLink) => void;
  onState: (state: Remote.RelayState) => void;
  /** Connected, or the account's membership records changed: time to fetch them. */
  onMembers: () => void;
  /** A control frame from the relay that isn't one: dropped. */
  onMalformed?: (raw: string) => void;
}): MachineConnection {
  const channels = new Map<number, ReturnType<typeof channelLink>>();

  /** One connection: fails when it couldn't open, succeeds when an open one dropped, so the next drop starts the backoff over. */
  const connectOnce = (token: string) =>
    Effect.callback<void, Unreachable>((resume) => {
      const ws = new WebSocket(
        url('/v1/connect', { role: 'machine', machine: options.machineId }),
        { headers: { authorization: `Bearer ${token}` } },
      );
      let isOpen = false;
      let isAwaitingPong = false;
      const heartbeat = setInterval(() => {
        if (isAwaitingPong) return ws.terminate();
        isAwaitingPong = true;
        if (ws.readyState === ws.OPEN) ws.send(HEARTBEAT.ping);
      }, HEARTBEAT_MS);
      ws.on('open', () => {
        isOpen = true;
        ws.send(
          JSON.stringify({
            type: 'register',
            name: options.name(),
            publicKey: options.publicKey,
          }),
        );
        options.onState({ status: 'connected' });
        options.onMembers();
      });
      ws.on('message', (data, isBinary) => {
        isAwaitingPong = false;
        const bytes = toBytes(data as Buffer);
        return isBinary
          ? onData(bytes)
          : onControl(ws, new TextDecoder().decode(bytes));
      });
      ws.on('unexpected-response', (_request, response) => {
        options.onState({
          status: 'error',
          error:
            response.statusCode === 401
              ? 'The relay didn’t accept your Mochi session'
              : `The relay answered ${response.statusCode}`,
        });
        ws.terminate();
      });
      // Every failure also closes the socket; the close is what's acted on.
      ws.on('error', () => {});
      ws.on('close', () => {
        clearInterval(heartbeat);
        for (const channel of channels.values())
          channel.end(1001, 'The relay connection dropped');
        channels.clear();
        resume(isOpen ? Effect.void : Effect.fail(new Unreachable()));
      });
      return Effect.sync(() => {
        clearInterval(heartbeat);
        ws.close(1000, 'Turned off');
      });
    });

  const run = Effect.gen(function* () {
    options.onState({ status: 'connecting' });
    const token = yield* Effect.tryPromise(options.token);
    yield* connectOnce(token).pipe(
      Effect.tapError(() =>
        Effect.sync(() => options.onState({ status: 'connecting' })),
      ),
    );
  }).pipe(
    Effect.retry({
      schedule: reconnect,
      while: (error) => error instanceof Unreachable,
    }),
    Effect.forever,
    // Signed out or the session ended: nothing to reconnect with until you sign in again.
    Effect.catch((error) =>
      Effect.sync(() =>
        options.onState({ status: 'error', error: messageOf(error) }),
      ),
    ),
  );

  function onControl(socket: WebSocket, text: string) {
    if (text === HEARTBEAT.pong) return;
    const frame = decodeRelayToMachine(text);
    if (!frame) return options.onMalformed?.(text);
    if (frame.type === 'open') {
      const channel = channelLink(socket, frame.channel, () =>
        channels.delete(frame.channel),
      );
      channels.set(frame.channel, channel);
      options.onChannel(channel.link);
    }
    if (frame.type === 'close')
      channels.get(frame.channel)?.end(1000, 'The device left');
    if (frame.type === 'members') options.onMembers();
  }

  function onData(framed: Uint8Array) {
    const split = splitChannel(framed);
    if (split) channels.get(split.channel)?.deliver(split.bytes);
  }

  const fiber = Effect.runFork(run);
  return {
    close() {
      Effect.runFork(Fiber.interrupt(fiber));
      options.onState({ status: 'off' });
    },
  };
}

/** The relay didn't take the connection. Anything else (`token()` rejected) means there is no session to connect with. */
class Unreachable extends Data.TaggedError('Unreachable') {}
const messageOf = (error: unknown) => {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return cause instanceof Error ? cause.message : String(cause);
};

/**
 * A device's own connection to one machine through the relay: its bytes, unprefixed, kept alive by text pings the relay's
 * runtime answers. Rejects when the machine is offline.
 */
export function openDeviceChannel(
  machineId: string,
  deviceId: string,
  token: string,
): Promise<RawLink> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      url('/v1/connect', {
        role: 'device',
        machine: machineId,
        device: deviceId,
      }),
      { headers: { authorization: `Bearer ${token}` } },
    );
    ws.on('open', () => {
      keepAlive(ws, () => ws.send(HEARTBEAT.ping));
      resolve(socketLink(ws));
    });
    ws.on('unexpected-response', (_request, response) => {
      reject(
        new Error(
          response.statusCode === 404
            ? 'That computer is offline'
            : `The relay answered ${response.statusCode}`,
        ),
      );
      ws.terminate();
    });
    ws.on('error', reject);
  });
}

export const listMachines = (token: string) =>
  relayHttp(
    token,
    HttpClientRequest.get(url('/v1/machines')),
    HttpClientResponse.schemaBodyJson(Schema.Array(RelayMachine)),
  );

/** The account's signed membership records; `members.ts` decides which to believe. */
export const listMembers = (token: string) =>
  relayHttp(
    token,
    HttpClientRequest.get(url('/v1/members')),
    (response) => response.json,
  );

export const publishMembers = (token: string, records: unknown[]) =>
  relayHttp(
    token,
    HttpClientRequest.post(url('/v1/members')).pipe(
      HttpClientRequest.bodyJsonUnsafe(records),
    ),
    () => Effect.void,
  );

export const forgetMachineAtRelay = (token: string, machineId: string) =>
  relayHttp(
    token,
    HttpClientRequest.delete(
      url(`/v1/machines/${encodeURIComponent(machineId)}`),
    ),
    () => Effect.void,
  );

const RELAY_TIMEOUT = '15 seconds';

/** The relay's HTTP API, for main: a status outside 2xx rejects with `RelayRefused`, a body of the wrong shape with a `SchemaError`. */
const relayHttp = <A, E>(
  token: string,
  request: HttpClientRequest.HttpClientRequest,
  body: (
    response: HttpClientResponse.HttpClientResponse,
  ) => Effect.Effect<A, E>,
) =>
  HttpClient.HttpClient.pipe(
    Effect.flatMap((client) =>
      HttpClient.filterStatusOk(client).execute(
        HttpClientRequest.bearerToken(request, token),
      ),
    ),
    Effect.catchReason('HttpClientError', 'StatusCodeError', (reason) =>
      Effect.fail(new RelayRefused({ status: reason.response.status })),
    ),
    Effect.flatMap(body),
    Effect.timeout(RELAY_TIMEOUT),
    Effect.provide(NodeHttpClient.layerUndici),
    Effect.runPromise,
  );

export class RelayRefused extends Data.TaggedError('RelayRefused')<{
  status: number;
}> {
  override get message() {
    return `The relay answered ${this.status}`;
  }
}

/** One device's channel on the machine's socket, as a `RawLink`. */
function channelLink(socket: WebSocket, channel: number, forget: () => void) {
  const reader = queuedReader();
  const closes: ((code: number, reason: string) => void)[] = [];
  let isOpen = true;
  const end = (code: number, reason: string) => {
    if (!isOpen) return;
    isOpen = false;
    forget();
    for (const listener of closes) listener(code, reason);
  };
  const link: RawLink = {
    send: (bytes) =>
      isOpen &&
      socket.readyState === socket.OPEN &&
      socket.send(withChannel(channel, bytes)),
    close(code, reason) {
      if (isOpen && socket.readyState === socket.OPEN)
        socket.send(JSON.stringify({ type: 'close', channel }));
      end(code, reason);
    },
    onMessage: reader.set,
    onClose: (listener) => void closes.push(listener),
    isOpen: () => isOpen,
  };
  return {
    link,
    end,
    deliver: (bytes: Uint8Array) => isOpen && reader.deliver(bytes),
  };
}

function url(path: string, params?: Record<string, string>) {
  const target = new URL(path, RELAY_URL);
  if (path === '/v1/connect')
    target.protocol = target.protocol === 'http:' ? 'ws:' : 'wss:';
  if (params) target.search = new URLSearchParams(params).toString();
  return target.href;
}
