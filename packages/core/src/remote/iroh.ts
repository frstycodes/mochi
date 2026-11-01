import type * as Iroh from '@number0/iroh';
import type {
  BiStream,
  Connection,
  Endpoint,
  EndpointBuilder,
  PathEvent,
} from '@number0/iroh';
import { queuedReader, type RawLink } from './link.ts';

export const IROH_ALPN = [...new TextEncoder().encode('mochi/remote/1')];

export type IrohBinding = typeof Iroh;

/** Which way a connection's packets go now: straight to the peer, or through an iroh relay. */
export type IrohPath = 'direct' | 'relay';

/** How an endpoint reaches the world. Tests bind on loopback with no relay and no discovery. */
export type IrohPreset = (builder: EndpointBuilder, iroh: IrohBinding) => void;

/** n0's relays and discovery; `MOCHI_IROH_RELAY` (comma-separated URLs) puts its relays in place of n0's. */
const defaultPreset: IrohPreset = (builder, iroh) => {
  iroh.presetN0(builder);
  const urls = customRelays();
  if (urls.length) builder.relayMode(iroh.RelayMode.customFromUrls(urls));
};

export const customRelays = () =>
  (process.env.MOCHI_IROH_RELAY ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

/**
 * The native binding, or why it didn't load. `@number0/iroh` is optional and has no darwin-x64 prebuild, so an Intel Mac
 * stays on the WebSocket routes.
 */
export async function loadIroh(): Promise<
  { iroh: IrohBinding } | { reason: string }
> {
  try {
    const loaded = (await import('@number0/iroh')) as IrohBinding & {
      default?: IrohBinding;
    };
    return { iroh: loaded.default ?? loaded };
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Where a peer may be: its home relay from its last welcome or listing, and addresses (tests, which have no discovery). */
export interface IrohHint {
  relay?: string;
  addresses?: readonly string[];
}

export interface IrohLink extends RawLink {
  /** The peer's EndpointId, which is its Ed25519 device key: QUIC's handshake proved it holds it. */
  readonly peer: Uint8Array;
  readonly side: 'dialled' | 'accepted';
  path(): IrohPath | undefined;
}

export interface IrohNode {
  /** EndpointId, hex: this computer's device public key. */
  readonly id: string;
  homeRelay(): string | undefined;
  /** The local sockets it is bound to. */
  sockets(): string[];
  dial(publicKey: Uint8Array, hint?: IrohHint): Promise<IrohLink>;
  /** Hands each incoming link to `onLink`; while undefined, every incoming connection is refused. */
  accept(onLink: ((link: IrohLink) => void) | undefined): void;
  links(): readonly IrohLink[];
  close(): Promise<void>;
}

export interface IrohEvents {
  /** A connection opened, failed or changed path, for `diagnostics`. */
  note?: (message: string) => void;
  onHomeRelay?: (url: string | undefined) => void;
}

/**
 * This computer's one endpoint, keyed with its device seed so its EndpointId is its member key. One per computer: two
 * endpoints on one key would fight over its home relay and discovery record, so main dials through Core's.
 */
export async function bindIroh(
  iroh: IrohBinding,
  seed: Uint8Array,
  { preset = defaultPreset, ...events }: IrohEvents & { preset?: IrohPreset },
): Promise<IrohNode> {
  const builder = iroh.Endpoint.builder();
  preset(builder, iroh);
  builder.secretKey([...seed]);
  builder.alpns([IROH_ALPN]);
  const endpoint = await builder.bind();
  const note = events.note ?? (() => {});
  const live = new Set<IrohLink>();
  let onLink: ((link: IrohLink) => void) | undefined;

  const track = (link: IrohLink) => {
    live.add(link);
    link.onClose(() => live.delete(link));
    note(`iroh: ${describe(link)} connected, ${link.path() ?? 'no path yet'}`);
    return link;
  };

  const homeRelay = () => endpoint.addr().relayUrl() ?? undefined;
  const relayWatch = endpoint.watchHomeRelay(
    callback<string[]>((urls) => {
      note(`iroh: home relay ${urls[0] ?? 'none'}`);
      events.onHomeRelay?.(urls[0]);
    }) as unknown as (urls: string[]) => void,
  );

  void acceptLoop(endpoint, async (incoming) => {
    if (!onLink) return incoming.refuse();
    const connection = await (await incoming.accept()).connect();
    const stream = await connection.acceptBi();
    onLink?.(track(tracked(connection, stream, 'accepted', note)));
  });

  return {
    id: endpoint.id().toString(),
    homeRelay,
    sockets: () => endpoint.boundSockets(),
    async dial(publicKey, hint = {}) {
      const addr = new iroh.EndpointAddr(
        iroh.EndpointId.fromBytes([...publicKey]),
        hint.relay ?? null,
        hint.addresses ? [...hint.addresses] : null,
      );
      try {
        const connection = await endpoint.connect(addr, IROH_ALPN);
        const stream = await connection.openBi();
        return track(tracked(connection, stream, 'dialled', note));
      } catch (error) {
        note(
          `iroh: dialling ${shortId(publicKey)} failed: ${messageOf(error)}`,
        );
        throw error;
      }
    },
    accept: (next) => void (onLink = next),
    links: () => [...live],
    async close() {
      await relayWatch.stop();
      for (const link of live) link.close(1001, 'Remote access turned off');
      await endpoint.close();
    },
  };
}

async function acceptLoop(
  endpoint: Endpoint,
  handle: (incoming: Iroh.Incoming) => Promise<void>,
) {
  for (;;) {
    const incoming = await endpoint.acceptNext().catch(() => null);
    if (!incoming) return;
    void handle(incoming).catch(() => {});
  }
}

/** A link that follows its connection's selected path, noting each change. */
function tracked(
  connection: Connection,
  stream: BiStream,
  side: IrohLink['side'],
  note: (message: string) => void,
): IrohLink {
  const raw = irohLink(connection, stream);
  const peer = Uint8Array.from(connection.remoteId().toBytes());
  let path = selectedPath(connection);
  const link: IrohLink = { ...raw, peer, side, path: () => path };
  const watch = connection.watchPathEvents(
    callback<PathEvent>((event) => {
      if (event.kind !== 'Selected' && event.kind !== 'Closed') return;
      const next = selectedPath(connection);
      if (next === path) return;
      path = next;
      note(`iroh: ${describe(link)} path now ${next ?? 'none'}`);
    }) as unknown as (event: PathEvent) => void,
  );
  raw.onClose(() => void watch.stop());
  return link;
}

function selectedPath(connection: Connection): IrohPath | undefined {
  const selected = connection.paths().find((p) => p.isSelected);
  if (!selected) return undefined;
  return selected.isRelay ? 'relay' : 'direct';
}

/** The binding's watch callbacks are called `(error, value)` (napi's convention), not with the value alone as typed. */
const callback =
  <A>(listener: (value: A) => void) =>
  (error: unknown, value: A) => {
    if (error === null || error === undefined) listener(value);
  };

const describe = (link: IrohLink) =>
  `${link.side === 'dialled' ? 'to' : 'from'} ${shortId(link.peer)}`;

const shortId = (publicKey: Uint8Array) =>
  Buffer.from(publicKey).toString('hex').slice(0, 10);

/** Above the largest frame pairing sends (a 512 KB piece plus its header and tag); a bigger length is a broken peer. */
const MAX_FRAME_BYTES = 1024 * 1024;
const LENGTH_BYTES = 4;
const READ_BYTES = 64 * 1024;
/** How long `close` waits for the peer to acknowledge what was sent before it closes the connection anyway. */
const FLUSH_MS = 2000;
const ABNORMAL_CLOSE = 1006;

/**
 * A QUIC stream as a `RawLink`: each message goes as a 4-byte big-endian length and its bytes. `close` carries its code
 * and reason in QUIC's application close, after what was sent before it has reached the peer, like a WebSocket's.
 */
function irohLink(connection: Connection, stream: BiStream): RawLink {
  const reader = queuedReader();
  const closeListeners: ((code: number, reason: string) => void)[] = [];
  let isOpen = true;
  let writing = Promise.resolve();
  const send = stream.send;

  const closed = (code: number, reason: string) => {
    if (!isOpen) return;
    isOpen = false;
    for (const listener of closeListeners) listener(code, reason);
  };
  void connection.closed().then((text) => closed(...closeOf(text)));
  void readFrames(stream, reader.deliver).catch(() =>
    connection.close(BigInt(4413), [...encode('Frame too large')]),
  );

  return {
    send(bytes) {
      if (!isOpen) return;
      const frame = new Uint8Array(LENGTH_BYTES + bytes.length);
      new DataView(frame.buffer).setUint32(0, bytes.length);
      frame.set(bytes, LENGTH_BYTES);
      // The binding takes bytes as `Array<number>`: one copy per frame.
      writing = writing.then(() => send.writeAll([...frame])).catch(() => {});
    },
    close(code, reason) {
      if (!isOpen) return;
      closed(code, reason);
      void writing
        .then(() => send.finish())
        .then(() => withTimeout(send.stopped(), FLUSH_MS))
        .catch(() => {})
        .then(() => connection.close(BigInt(code), [...encode(reason)]));
    },
    onMessage: reader.set,
    onClose: (listener) => void closeListeners.push(listener),
    isOpen: () => isOpen,
  };
}

async function readFrames(
  stream: BiStream,
  deliver: (bytes: Uint8Array) => void,
) {
  let held = Buffer.alloc(0);
  for (;;) {
    const chunk = await stream.recv.read(READ_BYTES);
    if (!chunk.length) return;
    held = Buffer.concat([held, Buffer.from(chunk)]);
    while (held.length >= LENGTH_BYTES) {
      const size = held.readUInt32BE(0);
      if (size > MAX_FRAME_BYTES) throw new Error('Frame too large');
      if (held.length < LENGTH_BYTES + size) break;
      deliver(new Uint8Array(held.subarray(LENGTH_BYTES, LENGTH_BYTES + size)));
      held = held.subarray(LENGTH_BYTES + size);
    }
  }
}

/**
 * `Connection.closed()` only gives the error's text, e.g. "closed by peer: Refused (code 4401)" (quinn's
 * `ApplicationClose` display). Anything else (a timeout, a reset) reads as a WebSocket's abnormal close.
 */
function closeOf(text: string): [code: number, reason: string] {
  const withReason = /^closed by peer: (.*) \(code (\d+)\)$/s.exec(text);
  if (withReason) return [Number(withReason[2]), withReason[1]!];
  const codeOnly = /^closed by peer: code (\d+)$/.exec(text);
  if (codeOnly) return [Number(codeOnly[1]), ''];
  return [ABNORMAL_CLOSE, text];
}

const encode = (text: string) => new TextEncoder().encode(text);

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const withTimeout = <A>(promise: Promise<A>, ms: number) =>
  Promise.race([promise, new Promise<void>((r) => setTimeout(r, ms))]);
