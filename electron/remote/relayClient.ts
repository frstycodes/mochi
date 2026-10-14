import WebSocket from 'ws';
import { HEARTBEAT, splitChannel, withChannel, type RelayToMachine } from '../../infra/relay/src/protocol.ts';
import type { RelayState } from '../../src/host/types/remote.ts';
import { queuedReader, socketLink, toBytes, type RawLink } from './link.ts';

/** Mochi's hosted relay (`infra/relay`); `MOCHI_RELAY_URL` points dev runs and self-hosters at another. */
export const RELAY_URL = process.env.MOCHI_RELAY_URL ?? 'https://mochi-relay.sandeshpandey.workers.dev';

const MAX_BACKOFF_MS = 60_000;
/** A socket can die without a close reaching either end; one unanswered ping in this long and it's dropped and redialed. */
const HEARTBEAT_MS = 30_000;

export interface RelayMachine {
  id: string;
  name: string;
  publicKey: string;
  isOnline: boolean;
}

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
  onState: (state: RelayState) => void;
}): MachineConnection {
  let socket: WebSocket | undefined;
  let isClosed = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const channels = new Map<number, ReturnType<typeof channelLink>>();

  async function open() {
    options.onState({ status: 'connecting' });
    let token: string;
    try {
      token = await options.token();
    } catch (error) {
      // Signed out or the session ended: nothing to reconnect with until you sign in again.
      return options.onState({ status: 'error', error: (error as Error).message });
    }
    if (isClosed) return;
    const ws = new WebSocket(url('/v1/connect', { role: 'machine', machine: options.machineId }), { headers: { authorization: `Bearer ${token}` } });
    socket = ws;
    let isAwaitingPong = false;
    const heartbeat = setInterval(() => {
      if (isAwaitingPong) return ws.terminate();
      isAwaitingPong = true;
      if (ws.readyState === ws.OPEN) ws.send(HEARTBEAT.ping);
    }, HEARTBEAT_MS);
    ws.on('open', () => {
      attempt = 0;
      ws.send(JSON.stringify({ type: 'register', name: options.name(), publicKey: options.publicKey }));
      options.onState({ status: 'connected' });
    });
    ws.on('message', (data, isBinary) => {
      isAwaitingPong = false;
      const bytes = toBytes(data as Buffer);
      return isBinary ? onData(bytes) : onControl(new TextDecoder().decode(bytes));
    });
    ws.on('unexpected-response', (_request, response) => {
      options.onState({ status: 'error', error: response.statusCode === 401 ? 'The relay didn’t accept your Mochi session' : `The relay answered ${response.statusCode}` });
      ws.terminate();
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearInterval(heartbeat);
      for (const channel of channels.values()) channel.end(1001, 'The relay connection dropped');
      channels.clear();
      if (isClosed || socket !== ws) return;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++);
      options.onState({ status: 'connecting' });
      retry = setTimeout(() => void open(), delay);
    });
  }

  function onControl(text: string) {
    if (text === HEARTBEAT.pong) return;
    let frame: RelayToMachine;
    try {
      frame = JSON.parse(text) as RelayToMachine;
    } catch {
      return;
    }
    if (frame.type === 'open' && socket) {
      const channel = channelLink(socket, frame.channel, () => channels.delete(frame.channel));
      channels.set(frame.channel, channel);
      options.onChannel(channel.link);
    }
    if (frame.type === 'close') channels.get(frame.channel)?.end(1000, 'The device left');
  }

  function onData(framed: Uint8Array) {
    const split = splitChannel(framed);
    if (split) channels.get(split.channel)?.deliver(split.bytes);
  }

  void open();
  return {
    close() {
      isClosed = true;
      clearTimeout(retry);
      socket?.close(1000, 'Turned off');
      options.onState({ status: 'off' });
    },
  };
}

/** A device's own connection to one machine through the relay: its bytes, unprefixed. Rejects when the machine is offline. */
export function openDeviceChannel(machineId: string, deviceId: string, token: string): Promise<RawLink> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url('/v1/connect', { role: 'device', machine: machineId, device: deviceId }), { headers: { authorization: `Bearer ${token}` } });
    ws.on('open', () => resolve(socketLink(ws)));
    ws.on('unexpected-response', (_request, response) => {
      reject(new Error(response.statusCode === 404 ? 'That computer is offline' : `The relay answered ${response.statusCode}`));
      ws.terminate();
    });
    ws.on('error', reject);
  });
}

export async function listMachines(token: string): Promise<RelayMachine[]> {
  const response = await fetch(url('/v1/machines'), { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`The relay answered ${response.status}`);
  return (await response.json()) as RelayMachine[];
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
    send: (bytes) => isOpen && socket.readyState === socket.OPEN && socket.send(withChannel(channel, bytes)),
    close(code, reason) {
      if (isOpen && socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'close', channel }));
      end(code, reason);
    },
    onMessage: reader.set,
    onClose: (listener) => void closes.push(listener),
    isOpen: () => isOpen,
  };
  return { link, end, deliver: (bytes: Uint8Array) => isOpen && reader.deliver(bytes) };
}

function url(path: string, params?: Record<string, string>) {
  const target = new URL(path, RELAY_URL);
  if (path === '/v1/connect') target.protocol = target.protocol === 'http:' ? 'ws:' : 'wss:';
  if (params) target.search = new URLSearchParams(params).toString();
  return target.href;
}
