import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import type { CommandResult, ConnectedDevice, RemoteCommandRequest } from '../../src/host/types/remote.ts';
import { socketLink, type Link, type RawLink } from './link.ts';
import type { ActionLog } from './log.ts';
import type { AuthenticatedDevice, Origin, Secured } from './pairing.ts';
import {
  COMMAND_SCOPES,
  hasScope,
  parseCommand,
  parseHello,
  PROTOCOL_VERSION,
  resultFrame,
  THIS_KIND,
  visibleAction,
  visibleSnapshot,
  type HelloFrame,
  type ServerFrame,
} from './protocol.ts';

/** The renderer, which owns the store: it snapshots it and runs commands through the UI's own code paths. */
export interface RendererBridge {
  /** `toSaved` of the store with exactly actions 1…`seq` of `epoch` applied. */
  snapshot(): Promise<{ epoch: string; seq: number; saved: { threads: { activity: object[] }[]; checkpoints: Record<string, unknown> } }>;
  run(request: RemoteCommandRequest): Promise<CommandResult>;
}

export interface RemoteServerOptions {
  hosts: string[];
  port: number;
  /** The pairing exchange every connection opens with (`pairing.ts`): who the device is, and its decrypted link. */
  secure: (raw: RawLink, origin: Origin) => Promise<Secured>;
  bridge: RendererBridge;
  log: ActionLog;
  machineName: () => string;
  onDevicesChange?: () => void;
}

export interface RemoteServer {
  /** `host:port` per bound interface. */
  addresses: string[];
  devices(): ConnectedDevice[];
  /** A relay channel: the same pairing and protocol as a LAN socket, but the device came through your account. */
  attach(raw: RawLink): void;
  /** Ends a device's connections, after it was removed. */
  disconnect(deviceId: string): void;
  /** One renderer action: logged, then sent to every device that is caught up and may read. */
  publish(epoch: string, seq: number, action: unknown): void;
  close(): Promise<void>;
}

const HELLO_TIMEOUT_MS = 10_000;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_RECEIPTS = 1000;
const SYNC_ATTEMPTS = 3;

/** A WebSocket server on each of `hosts`. No secret travels in the URL: the first frames pair and encrypt. */
export async function startRemoteServer(options: RemoteServerOptions): Promise<RemoteServer> {
  const { log, bridge } = options;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const connections = new Set<Connection>();
  // Keyed by device and command id, so a resend after a dropped connection gets the first run's result.
  const receipts = new Map<string, Promise<CommandResult>>();

  const servers = await Promise.all(options.hosts.map((host) => listen(host, options.port, wss)));
  const addresses = servers.map((s) => formatAddress(s.address() as AddressInfo));
  // Loopback would reach the device's own computer.
  const reachable = addresses.filter((a) => !a.startsWith('127.') && !a.startsWith('[::1]'));
  wss.on('connection', (socket) => void accept(socketLink(socket), 'lan'));

  async function accept(raw: RawLink, origin: Origin) {
    const secured = await options.secure(raw, origin).catch((error: unknown) => ({ refusal: `Couldn’t pair: ${String(error)}` }));
    if ('refusal' in secured) return raw.close(4401, 'Refused');
    const { link: socket, device } = secured;
    // One listener for the connection's life: the hello, then frames that arrive while it's checked, then commands.
    const held: string[] = [];
    let connection: Connection | undefined;
    let takeHello: ((text: string | null) => void) | undefined;
    const hello = await new Promise<HelloFrame | string | null>((resolve) => {
      const timer = setTimeout(() => resolve('No hello within 10 seconds'), HELLO_TIMEOUT_MS);
      takeHello = (text) => {
        clearTimeout(timer);
        resolve(text === null ? null : parseHello(text));
      };
      socket.onClose(() => takeHello?.(null));
      socket.onMessage((text) => {
        if (takeHello) {
          const take = takeHello;
          takeHello = undefined;
          return take(text);
        }
        if (connection?.isAccepting) return void onCommand(connection, text);
        held.push(text);
      });
    });
    takeHello = undefined;
    if (!hello) return;
    if (typeof hello === 'string') return refuse(socket, hello);
    if (!socket.isOpen()) return;
    connection = { socket, device, connectedAt: Date.now(), isLive: false };
    connections.add(connection);
    options.onDevicesChange?.();
    const live = connection;
    socket.onClose(() => {
      connections.delete(live);
      options.onDevicesChange?.();
    });
    send(socket, { type: 'welcome', version: PROTOCOL_VERSION, deviceId: device.deviceId, machineName: options.machineName(), machineKind: THIS_KIND, scopes: device.scopes, addresses: reachable });
    connection.isAccepting = true;
    for (const data of held) void onCommand(connection, data);
    if (!device.scopes.includes('read')) return;
    await catchUp(connection, hello.resume);
  }

  /** What the device missed if the log still holds it, otherwise a fresh snapshot and whatever arrived while it was taken. */
  async function catchUp(connection: Connection, resume?: HelloFrame['resume']) {
    const missed = resume && log.since(resume.epoch, resume.seq);
    if (missed) return goLive(connection, missed);
    for (let attempt = 0; attempt < SYNC_ATTEMPTS; attempt++) {
      const snapshot = await bridge.snapshot().catch(() => null);
      if (!connection.socket.isOpen()) return;
      if (!snapshot) continue;
      // Nothing of this epoch logged yet: the renderer started streaming and hasn't acted since.
      if (log.epoch !== snapshot.epoch) log.begin(snapshot.epoch, snapshot.seq);
      const after = log.since(snapshot.epoch, snapshot.seq);
      if (!after) continue;
      send(connection.socket, { type: 'snapshot', epoch: snapshot.epoch, seq: snapshot.seq, saved: visibleSnapshot(snapshot.saved, connection.device.scopes) });
      return goLive(connection, after);
    }
    refuse(connection.socket, 'Couldn’t read this machine’s threads; reconnect to try again');
  }

  function goLive(connection: Connection, missed: { seq: number; action: unknown }[]) {
    for (const { seq, action } of missed) sendAction(connection, seq, action);
    connection.isLive = true;
  }

  function sendAction(connection: Connection, seq: number, action: unknown) {
    send(connection.socket, { type: 'action', epoch: log.epoch, seq, action: visibleAction(action, connection.device.scopes) });
  }

  async function onCommand(connection: Connection, data: string) {
    const frame = parseCommand(data);
    if (typeof frame === 'string') return send(connection.socket, { type: 'result', id: '', isOk: false, error: frame });
    const { id, command } = frame;
    if (!hasScope(connection.device.scopes, command)) return send(connection.socket, { type: 'result', id, isOk: false, error: `This device can’t ${command.type}: it needs the ${COMMAND_SCOPES[command.type]} scope` });
    const key = `${connection.device.deviceId}\n${id}`;
    let result = receipts.get(key);
    if (!result) {
      result = bridge.run({ id, deviceName: connection.device.name, command }).catch((error: unknown) => ({ isOk: false as const, error: String(error) }));
      receipts.set(key, result);
      if (receipts.size > MAX_RECEIPTS) receipts.delete(receipts.keys().next().value!);
    }
    send(connection.socket, resultFrame(id, await result));
  }

  return {
    addresses,
    devices: () => [...connections].map(({ device, connectedAt }) => ({ id: device.deviceId, name: device.name, kind: device.kind, scopes: device.scopes, connectedAt })),
    attach: (raw) => void accept(raw, 'relay'),
    disconnect(deviceId) {
      for (const { socket, device } of connections) if (device.deviceId === deviceId) socket.close(4401, 'Removed or changed on this computer');
    },
    publish(epoch, seq, action) {
      const isNewEpoch = epoch !== log.epoch;
      log.append(epoch, seq, action);
      for (const connection of connections) {
        if (!connection.isLive) continue;
        // The renderer reloaded: numbers from before mean nothing, so each device starts over from a snapshot.
        if (isNewEpoch) {
          connection.isLive = false;
          void catchUp(connection);
          continue;
        }
        sendAction(connection, seq, action);
      }
    },
    async close() {
      for (const { socket } of connections) socket.close(1001, 'Remote access turned off');
      await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
      wss.close();
    },
  };
}

interface Connection {
  socket: Link;
  /** Welcomed: commands run as they arrive. Before that, they wait in `held`. */
  isAccepting?: boolean;
  device: AuthenticatedDevice;
  connectedAt: number;
  /** Caught up: gets each action as it happens. */
  isLive: boolean;
}

function listen(host: string, port: number, wss: WebSocketServer) {
  const server = createServer((_request, response) => response.writeHead(426, { 'content-type': 'text/plain' }).end('WebSocket only'));
  server.on('upgrade', (request, socket, head) => wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request)));
  return new Promise<Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

function refuse(socket: Link, reason: string) {
  send(socket, { type: 'refused', reason });
  socket.close(4401, 'Refused');
}

function send(socket: Link, frame: ServerFrame) {
  if (socket.isOpen()) socket.send(JSON.stringify(frame));
}

const formatAddress = ({ address, port, family }: AddressInfo) => (family === 'IPv6' ? `[${address}]:${port}` : `${address}:${port}`);
