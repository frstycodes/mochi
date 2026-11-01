import type {
  BiStream,
  Connection,
  Endpoint,
  EndpointAddr,
} from '@number0/iroh';
import { queuedReader, type RawLink } from './link.ts';

export const IROH_ALPN = [...new TextEncoder().encode('mochi/remote/1')];

/** Above the largest frame pairing sends (a 512 KB piece plus its header and tag); a bigger length is a broken peer. */
const MAX_FRAME_BYTES = 1024 * 1024;
const LENGTH_BYTES = 4;
const READ_BYTES = 64 * 1024;
/** How long `close` waits for the peer to acknowledge what was sent before it closes the connection anyway. */
const FLUSH_MS = 2000;
const ABNORMAL_CLOSE = 1006;

/** Dials `addr` (an EndpointId alone is enough when discovery or a relay knows it) and opens the link's stream. */
export async function dialIroh(
  endpoint: Endpoint,
  addr: EndpointAddr,
): Promise<RawLink> {
  const connection = await endpoint.connect(addr, IROH_ALPN);
  return irohLink(connection, await connection.openBi());
}

/** Hands each incoming connection's first stream to `onLink` until the endpoint closes. */
export async function acceptIroh(
  endpoint: Endpoint,
  onLink: (raw: RawLink, connection: Connection) => void,
) {
  for (;;) {
    const incoming = await endpoint.acceptNext();
    if (!incoming) return;
    void (async () => {
      const connection = await (await incoming.accept()).connect();
      onLink(irohLink(connection, await connection.acceptBi()), connection);
    })().catch(() => {});
  }
}

/**
 * A QUIC stream as a `RawLink`: each message goes as a 4-byte big-endian length and its bytes. `close` carries its code
 * and reason in QUIC's application close, after what was sent before it has reached the peer, like a WebSocket's.
 */
export function irohLink(connection: Connection, stream: BiStream): RawLink {
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

const withTimeout = <A>(promise: Promise<A>, ms: number) =>
  Promise.race([promise, new Promise<void>((r) => setTimeout(r, ms))]);
