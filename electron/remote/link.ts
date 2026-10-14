import type { WebSocket } from 'ws';

/** A socket can die without a close reaching either end; one unanswered ping in this long and it's dropped. */
export const HEARTBEAT_MS = 30_000;

/**
 * One connection between a device and this machine, whatever carries it: a LAN WebSocket or a relay channel. Binary only:
 * the relay forwards nothing else from devices, and after pairing every frame is ciphertext.
 */
export interface RawLink {
  send(bytes: Uint8Array): void;
  close(code: number, reason: string): void;
  /** One reader at a time, replacing the last; frames that arrive with none wait for the next, so none fall between two. */
  onMessage(listener: ((bytes: Uint8Array) => void) | undefined): void;
  onClose(listener: (code: number, reason: string) => void): void;
  isOpen(): boolean;
}

/** The same connection once paired: decrypted text frames of the remote protocol (`protocol.ts`). */
export interface Link {
  send(text: string): void;
  close(code: number, reason: string): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: () => void): void;
  isOpen(): boolean;
}

/** Text frames are never protocol: they are the relay's heartbeat, so they never reach the reader. */
export function socketLink(socket: WebSocket): RawLink {
  const reader = queuedReader();
  socket.on('message', (data, isBinary) => isBinary && reader.deliver(toBytes(data as Buffer)));
  return {
    send: (bytes) => socket.readyState === socket.OPEN && socket.send(bytes),
    close: (code, reason) => socket.close(code, reason),
    onMessage: reader.set,
    onClose: (listener) => void socket.on('close', (code, reason) => listener(code, reason.toString())),
    isOpen: () => socket.readyState === socket.OPEN,
  };
}

/** `RawLink.onMessage`'s single reader with a queue. */
export function queuedReader() {
  let listener: ((bytes: Uint8Array) => void) | undefined;
  const waiting: Uint8Array[] = [];
  return {
    deliver: (bytes: Uint8Array) => (listener ? listener(bytes) : void waiting.push(bytes)),
    set: (next: ((bytes: Uint8Array) => void) | undefined) => {
      listener = next;
      while (listener && waiting.length) listener(waiting.shift()!);
    },
  };
}

/** ws hands a message over as one Buffer, fragments or an ArrayBuffer depending on `binaryType`. */
export function toBytes(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  return new Uint8Array(Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data));
}

/** Pings every `HEARTBEAT_MS` and terminates the socket when nothing came back since the last one. */
export function keepAlive(socket: WebSocket, ping: () => void) {
  let isAwaitingPong = false;
  const alive = () => (isAwaitingPong = false);
  socket.on('message', alive);
  socket.on('pong', alive);
  const timer = setInterval(() => {
    if (isAwaitingPong) return socket.terminate();
    isAwaitingPong = true;
    if (socket.readyState === socket.OPEN) ping();
  }, HEARTBEAT_MS);
  socket.on('close', () => clearInterval(timer));
}
