import { DurableObject } from 'cloudflare:workers';
import { userFromRequest } from './auth.ts';
import { oauthBounce } from './oauth.ts';
import { HEARTBEAT, isId } from './protocol.ts';
import type { StoredRecord } from './protocol.ts';
import {
  Relay,
  type Attachment,
  type MachineRecord,
  type Room,
} from './relay.ts';

interface Env {
  ACCOUNTS: DurableObjectNamespace<AccountRelay>;
  /** The Clerk instance's Frontend API URL, the tokens' `iss`. */
  CLERK_ISSUER: string;
  /** Mochi's OAuth client id, the tokens' `client_id`. */
  CLERK_CLIENT_ID: string;
}

/**
 * Mochi's relay (DEVICES.md › Transport): reach a machine from anywhere. Every route but /oauth/callback needs the account's Clerk token in
 * `Authorization` (never in the URL), and each account gets its own Durable Object, so accounts never share state.
 *
 * GET    /v1/machines          the account's machines: id, public key, online, same site, and their sealed info
 * DELETE /v1/machines/:id      forget a machine
 * GET    /v1/members           the account's signed membership records
 * POST   /v1/members           add records (JSON array); online machines hear `{ type: 'members' }`
 * GET    /oauth/callback       public: a connector sign-in returning, sent on to Mochi at 127.0.0.1 (`oauth.ts`)
 * GET    /v1/connect           WebSocket. `role=machine&machine=<id>`, or `role=device&machine=<id>&device=<id>`
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    // The browser lands here with no Clerk token: the one public route, a redirect to 127.0.0.1 only.
    if (url.pathname === '/oauth/callback' && request.method === 'GET')
      return oauthBounce(url);
    const user = await userFromRequest(
      request,
      env.CLERK_ISSUER,
      env.CLERK_CLIENT_ID,
    );
    if (!user) return new Response('Sign in to Mochi first', { status: 401 });
    if (!url.pathname.startsWith('/v1/'))
      return new Response('Not found', { status: 404 });
    // The user id rides in a header the Worker sets itself; the Durable Object is reachable only through this Worker.
    const headers = new Headers(request.headers);
    headers.set('x-mochi-user', user);
    headers.delete('authorization');
    return env.ACCOUNTS.get(env.ACCOUNTS.idFromName(user)).fetch(
      new Request(request, { headers }),
    );
  },
} satisfies ExportedHandler<Env>;

export class AccountRelay extends DurableObject<Env> {
  private readonly relay = new Relay<WebSocket>(this.room());

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeats answered by the runtime without waking the object: a client that hears no pong knows its socket is dead.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(HEARTBEAT.ping, HEARTBEAT.pong),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const machinePath = /^\/v1\/machines\/([^/]+)$/.exec(url.pathname);
    if (url.pathname === '/v1/machines' && request.method === 'GET')
      return Response.json(
        await this.relay.list(
          request.headers.get('cf-connecting-ip') ?? undefined,
        ),
      );
    if (machinePath && request.method === 'DELETE') {
      if (!isId(machinePath[1]))
        return new Response('Bad machine id', { status: 400 });
      await this.relay.remove(machinePath[1]);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/v1/members' && request.method === 'GET')
      return Response.json(await this.relay.members());
    if (url.pathname === '/v1/members' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!Array.isArray(body))
        return new Response('Expected an array of records', { status: 400 });
      await this.relay.addMembers(body);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/v1/connect')
      return this.upgrade(request, url.searchParams);
    return new Response('Not found', { status: 404 });
  }

  private upgrade(request: Request, params: URLSearchParams) {
    if (request.headers.get('upgrade') !== 'websocket')
      return new Response('WebSocket only', { status: 426 });
    const role = params.get('role');
    const machine = params.get('machine');
    const device = params.get('device');
    if (
      !isId(machine) ||
      (role === 'device' && !isId(device)) ||
      (role !== 'machine' && role !== 'device')
    )
      return new Response('Bad connect parameters', { status: 400 });
    const admission =
      role === 'machine'
        ? this.relay.admit(
            'machine',
            machine,
            request.headers.get('cf-connecting-ip') ?? undefined,
          )
        : this.relay.admit('device', machine, device!);
    if ('refusal' in admission)
      return new Response(admission.refusal, {
        status: admission.code === 4404 ? 404 : 400,
      });
    const [client, server] = Object.values(new WebSocketPair());
    // Hibernation API: the object can sleep between frames without dropping sockets; attachments carry who is who.
    this.ctx.acceptWebSocket(server, admission.tags);
    server.serializeAttachment(admission.attachment);
    this.relay.opened(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    await this.relay.message(socket, message);
  }

  async webSocketClose(socket: WebSocket) {
    this.relay.closed(socket);
  }

  async webSocketError(socket: WebSocket) {
    this.relay.closed(socket);
  }

  private room(): Room<WebSocket> {
    const storage = this.ctx.storage;
    return {
      byTag: (tag) => this.ctx.getWebSockets(tag),
      attachment: (socket) => socket.deserializeAttachment() as Attachment,
      send: (socket, data) => socket.send(data),
      close: (socket, code, reason) => socket.close(code, reason),
      machines: async () =>
        (await storage.get<Record<string, MachineRecord>>('machines')) ?? {},
      saveMachines: (machines) => storage.put('machines', machines),
      records: async () =>
        (await storage.get<Record<string, StoredRecord>>('members')) ?? {},
      saveRecords: (records) => storage.put('members', records),
    };
  }
}
