import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Schema } from 'effect';
import { WebSocketServer } from 'ws';
import { Backend, Relay } from '@mochi/schema';
import { socketLink, type Link, type RawLink } from './link.ts';
import type { DeviceGrant } from './token.ts';
import { tunnel } from './tunnel.ts';
import type {
  ConnectedDevice,
  Scope,
} from '../../../../apps/desktop/src/host/types/remote.ts';
import {
  type AuthenticatedDevice,
  type Origin,
  type Secured,
} from './pairing.ts';

export interface RemoteServerOptions {
  hosts: string[];
  /** Preferred; when something else holds it, any free port instead (`onPortTaken`). */
  port: number;
  onPortTaken?: (wanted: number, bound: number) => void;
  /** The pairing exchange every connection opens with (`pairing.ts`): who the device is, and its decrypted link. */
  secure: (raw: RawLink, origin: Origin) => Promise<Secured>;
  /** Core's address and a token holding this device to its scopes (signed with Core's internal token, `service.ts`). */
  coreFor: (
    grant: DeviceGrant,
  ) => Promise<{ url: string; token: string; ca?: Buffer }>;
  /** This computer's Core's descriptor (`backend.info`), with `scopes` the device's; sent in each welcome. */
  backend: (scopes: Scope[]) => Promise<Backend.BackendInfo>;
  /** A device's frame that was refused, for the log. */
  onRejected: (device: string, reason: string) => void;
  onDevicesChange?: () => void;
  /** This computer's membership records, sent in each welcome. */
  members?: () => unknown;
  /** A device's records, from its hello or a later `members` frame. */
  onMembers?: (members: unknown) => void;
}

export interface RemoteServer {
  /** `host:port` per bound interface, as they are now. */
  readonly addresses: string[];
  /** The one port every host listens on: `options.port`, or the free one taken when it was busy. */
  readonly port: number;
  /**
   * Listens on `hosts` from now on: stops on the ones that went away, starts on new ones. Connected devices stay connected
   * where their address still exists. Rejects when a new host couldn't be bound; the others are bound anyway.
   */
  rebind(hosts: string[]): Promise<void>;
  devices(): ConnectedDevice[];
  /** A relay channel: the same pairing and tunnel as a LAN socket, but the device came through your account. */
  attach(raw: RawLink): void;
  /** Ends a device's connections, after it was removed or its scopes changed. */
  disconnect(deviceId: string): void;
  /** Membership records changed: every welcomed device hears them. */
  publishMembers(members: unknown): void;
  close(): Promise<void>;
}

const HELLO_TIMEOUT_MS = 10_000;
const MAX_FRAME_BYTES = 1024 * 1024;
const decodeHello = Schema.decodeUnknownExit(
  Schema.fromJsonString(Relay.HelloFrame),
);

interface Connection {
  socket: Link;
  device: AuthenticatedDevice;
  connectedAt: number;
}

/**
 * A WebSocket server on each of `hosts`. No secret travels in the URL: the first frames pair and encrypt. Once a device
 * said hello, its link is a tunnel to Core's own RPC socket.
 */
export async function startRemoteServer(
  options: RemoteServerOptions,
): Promise<RemoteServer> {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
  });
  const connections = new Set<Connection>();
  const servers = new Map<string, Server>();
  const addresses = () =>
    [...servers.values()].map((s) => formatAddress(s.address() as AddressInfo));
  // Loopback would reach the device's own computer.
  const reachable = () =>
    addresses().filter((a) => !a.startsWith('127.') && !a.startsWith('[::1]'));
  let port = options.port;
  async function rebind(hosts: string[]) {
    await Promise.all(
      [...servers]
        .filter(([host]) => !hosts.includes(host))
        .map(([host, server]) => {
          servers.delete(host);
          return closeServer(server);
        }),
    );
    let pending = hosts.filter((host) => !servers.has(host));
    // Port 0 picks a different port per listen: the first one bound decides it for the rest.
    if (port === 0 && pending[0]) {
      const first = await listen(pending[0], 0, wss);
      servers.set(pending[0], first);
      port = (first.address() as AddressInfo).port;
      pending = pending.slice(1);
    }
    const added = await Promise.allSettled(
      pending.map(async (host) =>
        servers.set(host, await listen(host, port, wss)),
      ),
    );
    const failed = added.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
  }
  const closeAll = async () => {
    await Promise.all([...servers.values()].map(closeServer));
    servers.clear();
  };
  try {
    await rebind(options.hosts);
  } catch (e) {
    await closeAll();
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port === 0)
      throw e;
    // Another Mochi (a dev run, a second profile) holds it: devices learn the new port from the relay and each welcome.
    port = 0;
    try {
      await rebind(options.hosts);
    } catch (e) {
      await closeAll();
      throw e;
    }
    options.onPortTaken?.(options.port, port);
  }
  wss.on('connection', (socket) => void accept(socketLink(socket), 'lan'));

  async function accept(raw: RawLink, origin: Origin) {
    const secured = await options
      .secure(raw, origin)
      .catch((error: unknown) => ({
        refusal: `Couldn’t pair: ${String(error)}`,
      }));
    if ('refusal' in secured) return raw.close(4401, 'Refused');
    const { link: socket, device } = secured;
    const text = await firstMessage(socket);
    if (text === null) return;
    const hello = decodeHello(text);
    if (hello._tag === 'Failure') {
      const reason = String(hello.cause).includes('protocol')
        ? `This machine speaks protocol ${Relay.PROTOCOL_VERSION}; update Mochi on both sides`
        : 'The first frame must be hello';
      options.onRejected(device.name, `${reason}: ${text.slice(0, 200)}`);
      return refuse(socket, reason);
    }
    if (hello.value.members !== undefined)
      options.onMembers?.(hello.value.members);
    const core = await options.coreFor({
      id: device.deviceId,
      name: device.name,
      scopes: device.scopes,
    });
    if (!socket.isOpen()) return;
    tunnel(socket, {
      ...core,
      onMembers: options.onMembers,
      onMalformed: (frame) =>
        options.onRejected(device.name, `Malformed frame: ${frame}`),
    });
    const connection = { socket, device, connectedAt: Date.now() };
    connections.add(connection);
    socket.onClose(() => {
      connections.delete(connection);
      options.onDevicesChange?.();
    });
    options.onDevicesChange?.();
    send(socket, {
      type: 'welcome',
      version: Relay.PROTOCOL_VERSION,
      deviceId: device.deviceId,
      backend: await options.backend(device.scopes),
      addresses: reachable(),
      ...(options.members && { members: options.members() }),
    });
  }

  return {
    get addresses() {
      return addresses();
    },
    get port() {
      return port;
    },
    rebind,
    devices: () =>
      [...connections].map(({ device, connectedAt }) => ({
        id: device.deviceId,
        name: device.name,
        kind: device.kind,
        scopes: device.scopes,
        connectedAt,
      })),
    attach: (raw) => void accept(raw, 'relay'),
    disconnect(deviceId) {
      for (const { socket, device } of connections)
        if (device.deviceId === deviceId)
          socket.close(4401, 'Removed or changed on this computer');
    },
    publishMembers(members) {
      for (const { socket } of connections)
        send(socket, { type: 'members', members });
    },
    async close() {
      for (const { socket } of connections)
        socket.close(1001, 'Remote access turned off');
      await Promise.all([...servers.values()].map(closeServer));
      servers.clear();
      wss.close();
    },
  };
}

/** The hello, or null when the link closed or nothing came within `HELLO_TIMEOUT_MS` (that is refused too). */
function firstMessage(socket: Link) {
  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      refuse(socket, 'No hello within 10 seconds');
      resolve(null);
    }, HELLO_TIMEOUT_MS);
    socket.onClose(() => {
      clearTimeout(timer);
      resolve(null);
    });
    socket.onMessage((text) => {
      clearTimeout(timer);
      resolve(text);
    });
  });
}

function listen(host: string, port: number, wss: WebSocketServer) {
  const server = createServer((_request, response) =>
    response
      .writeHead(426, { 'content-type': 'text/plain' })
      .end('WebSocket only'),
  );
  server.on('upgrade', (request, socket, head) =>
    wss.handleUpgrade(request, socket, head, (ws) =>
      wss.emit('connection', ws, request),
    ),
  );
  return new Promise<Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

/** Stops listening now; a device still connected through it stays until its own socket closes. */
const closeServer = async (server: Server) => void server.close();

function refuse(socket: Link, reason: string) {
  send(socket, { type: 'refused', reason });
  socket.close(4401, 'Refused');
}

function send(socket: Link, frame: Relay.MachineLinkFrame) {
  if (socket.isOpen()) socket.send(JSON.stringify(frame));
}

const formatAddress = ({ address, port, family }: AddressInfo) =>
  family === 'IPv6' ? `[${address}]:${port}` : `${address}:${port}`;
