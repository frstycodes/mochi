import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';

export interface CdpRelayTarget {
  readonly send: (method: string, params: Record<string, unknown>, sessionId: string | undefined) => Promise<unknown>;
  readonly targetId: () => Promise<string>;
  readonly url: () => string;
  readonly title: () => string;
  readonly userAgent: () => string;
}

export interface CdpRelayConnection {
  readonly receive: (raw: string) => void;
  readonly event: (method: string, params: unknown, sessionId: string | undefined) => void;
}

interface CdpCommand {
  readonly id: number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
  readonly sessionId?: string;
}

const isCommand = (value: unknown): value is CdpCommand =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { id?: unknown }).id === 'number' &&
  typeof (value as { method?: unknown }).method === 'string';

const BROWSER_CONTEXT_ID = 'mochi';
const ANNOUNCE = Symbol('announce');
const PAGE_SESSION_ID = 'mochi-page';

// Electron's `will-download` owns downloads, so Playwright's download settings are accepted and ignored.
const ACKNOWLEDGED = new Set(['Target.setDiscoverTargets', 'Browser.grantPermissions', 'Browser.resetPermissions', 'Browser.setDownloadBehavior', 'Browser.cancelDownload']);

/** Electron allows one debugger client per webContents, so this relay shares the existing attach. */
export function createCdpRelayConnection(target: CdpRelayTarget, write: (message: string) => void): CdpRelayConnection {
  const send = (message: Record<string, unknown>) => write(JSON.stringify(message));
  let attached = false;
  const sessions = new Map<string, 'browser' | 'page'>([[PAGE_SESSION_ID, 'page']]);
  let sessionSequence = 0;
  const newSession = (kind: 'browser' | 'page') => {
    const sessionId = `mochi-${kind}-${++sessionSequence}`;
    sessions.set(sessionId, kind);
    return sessionId;
  };
  const targetInfo = async () => ({
    targetId: await target.targetId(),
    type: 'page',
    title: target.title(),
    url: target.url(),
    attached: true,
    canAccessOpener: false,
    browserContextId: BROWSER_CONTEXT_ID,
  });

  const browserCommand = async (command: CdpCommand): Promise<unknown> => {
    if (ACKNOWLEDGED.has(command.method)) return {};
    switch (command.method) {
      case 'Browser.getVersion':
        return {
          protocolVersion: '1.3',
          product: 'Electron',
          revision: '',
          userAgent: target.userAgent(),
          jsVersion: '',
        };
      case 'Target.getTargetInfo':
        return {
          targetInfo: {
            targetId: 'browser',
            type: 'browser',
            title: '',
            url: '',
            attached: true,
            canAccessOpener: false,
          },
        };
      case 'Target.getBrowserContexts':
        return { browserContextIds: [] };
      case 'Target.getTargets':
        return { targetInfos: [await targetInfo()] };
      case 'Target.attachToBrowserTarget':
        return { sessionId: newSession('browser') };
      case 'Target.attachToTarget': {
        const targetId = command.params?.['targetId'];
        if (targetId !== (await target.targetId())) throw new Error("Only this browser tab's page can be attached.");
        return { sessionId: newSession('page') };
      }
      case 'Target.detachFromTarget': {
        const sessionId = command.params?.['sessionId'];
        if (typeof sessionId === 'string' && sessionId !== PAGE_SESSION_ID) sessions.delete(sessionId);
        return {};
      }
      case 'Target.setAutoAttach': {
        if (attached) return {};
        attached = true;
        const info = await targetInfo();
        return {
          [ANNOUNCE]: {
            method: 'Target.attachedToTarget',
            params: { sessionId: PAGE_SESSION_ID, targetInfo: info, waitingForDebugger: false },
          },
        };
      }
      default:
        throw new Error(`Not supported for a desktop browser tab: ${command.method}`);
    }
  };

  const pageCommand = (command: CdpCommand): Promise<unknown> => {
    const child = sessions.get(command.sessionId!) === 'page' ? undefined : command.sessionId;
    // The page's own session is already running and is answered here. Child frames are paused by
    // waitForDebuggerOnStart, so the forwarded command is what resumes them.
    if (command.method === 'Runtime.runIfWaitingForDebugger' && child === undefined) return Promise.resolve({});
    return target.send(command.method, command.params ?? {}, child);
  };

  return {
    receive: (raw) => {
      let command: unknown;
      try {
        command = JSON.parse(raw);
      } catch {
        return;
      }
      if (!isCommand(command)) return;
      const result =
        command.sessionId === undefined || sessions.get(command.sessionId) === 'browser' ? browserCommand(command) : pageCommand(command);
      const route = command.sessionId === undefined ? {} : { sessionId: command.sessionId };
      // Replies leave as commands finish, so a slow command never holds up the ones behind it.
      void result.then(
        (value) => {
          const announce =
            typeof value === 'object' && value !== null && ANNOUNCE in value
              ? (value as { [ANNOUNCE]: Record<string, unknown> })[ANNOUNCE]
              : undefined;
          send({ id: command.id, result: announce ? {} : (value ?? {}), ...route });
          if (announce) send(announce);
        },
        (cause: unknown) =>
          send({
            id: command.id,
            error: {
              code: -32000,
              message: cause instanceof Error ? cause.message : String(cause),
            },
            ...route,
          }),
      );
    },
    event: (method, params, sessionId) => {
      if (!attached) return;
      // Download events go on the root session, where Playwright listens for them.
      if (method.startsWith('Browser.download')) {
        send({ method, params });
        return;
      }
      // Electron reports the page's own events with an empty session id.
      if (sessionId) {
        send({ method, params, sessionId });
        return;
      }
      for (const [id, kind] of sessions) if (kind === 'page') send({ method, params, sessionId: id });
    },
  };
}

export async function serveRelay(
  target: CdpRelayTarget,
): Promise<{ endpoint: string; close: () => void; event: CdpRelayConnection['event'] }> {
  const path = `/${randomBytes(16).toString('hex')}`;
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, path });
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  let relay: CdpRelayConnection | undefined;
  server.on('connection', (socket) => {
    if (relay) return socket.close(1008);
    const connection = createCdpRelayConnection(target, (message) => socket.send(message));
    relay = connection;
    socket.on('message', (data) => connection.receive((data as Buffer).toString()));
  });
  return {
    endpoint: `ws://127.0.0.1:${port}${path}`,
    close: () => {
      for (const client of server.clients) client.close();
      server.close();
    },
    event: (method, params, sessionId) => relay?.event(method, params, sessionId),
  };
}
