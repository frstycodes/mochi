import { DEFAULT_SCOPES, type CommandResult, type RemoteCommandRequest } from '../../src/host/types/remote.ts';
import type { Link, RawLink } from './link.ts';
import { ActionLog } from './log.ts';
import type { AuthenticatedDevice, Secured } from './pairing.ts';
import { startRemoteServer, type RendererBridge } from './server.ts';

// Test-only: a remote server with a stand-in renderer and pairing without the crypto.

const DEVICES = {
  laptop: { deviceId: 'd-laptop', name: 'Laptop', scopes: DEFAULT_SCOPES },
  viewer: { deviceId: 'd-viewer', name: 'Viewer', scopes: ['read' as const] },
};

/** A renderer stand-in: its store is a counter of applied actions, numbered within one epoch. */
function renderer(epoch = 'e1') {
  const runs: RemoteCommandRequest[] = [];
  const store = { epoch, seq: 0 };
  const bridge: RendererBridge = {
    snapshot: async () => ({ epoch: store.epoch, seq: store.seq, saved: { threads: [{ activity: [{ patch: '+secret' }] }], checkpoints: { t: {} } } }),
    run: async (request): Promise<CommandResult> => {
      runs.push(request);
      return { isOk: true };
    },
  };
  return { bridge, runs, store };
}

export async function serve(capacity?: number) {
  const r = renderer();
  const log = new ActionLog(capacity);
  const server = await startRemoteServer({ hosts: ['127.0.0.1'], port: 0, secure: plainSecure(DEVICES), bridge: r.bridge, log, machineName: () => 'Studio' });
  /** What the renderer does for each action: applies it, then pushes it. */
  const act = (n = 1) => {
    for (let i = 0; i < n; i++) server.publish(r.store.epoch, ++r.store.seq, { type: 'tick', n: r.store.seq });
  };
  return { server, act, ...r };
}

/**
 * Pairing without the crypto (`pairing.test.ts` covers that): the first frame names a device, then frames pass as text.
 * An unknown name gets the same `refused` frame real pairing sends.
 */
export function plainSecure(devices: Record<string, AuthenticatedDevice>) {
  return async (raw: RawLink): Promise<Secured> => {
    const name = await new Promise<string | null>((resolve) => {
      raw.onMessage((bytes) => {
        raw.onMessage(undefined);
        resolve(Buffer.from(bytes).toString('utf8'));
      });
      raw.onClose(() => resolve(null));
    });
    if (!name || !Object.hasOwn(devices, name)) {
      raw.send(Buffer.from(JSON.stringify({ type: 'refused', reason: 'Unknown device' })));
      return { refusal: 'Unknown device' };
    }
    return {
      device: devices[name],
      link: {
        send: (text) => raw.send(Buffer.from(text)),
        close: (code, reason) => raw.close(code, reason),
        onMessage: (listener) => raw.onMessage((bytes) => listener(Buffer.from(bytes).toString('utf8'))),
        onClose: (listener) => raw.onClose(() => listener()),
        isOpen: () => raw.isOpen(),
      },
    };
  };
}

/** `plainSecure`'s device side: names itself, then frames pass as text. */
export function plainDevice(raw: RawLink, name: string): Link {
  raw.send(Buffer.from(name));
  return {
    send: (text) => raw.send(Buffer.from(text)),
    close: (code, reason) => raw.close(code, reason),
    onMessage: (listener) => raw.onMessage((bytes) => listener(Buffer.from(bytes).toString('utf8'))),
    onClose: (listener) => raw.onClose(() => listener()),
    isOpen: () => raw.isOpen(),
  };
}
