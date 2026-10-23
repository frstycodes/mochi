import { app, utilityProcess, type UtilityProcess, type WebContents } from 'electron';
import { Effect, Schedule } from 'effect';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import type { Capabilities } from '@mochi/schema';
import { connectCore, coreUrl } from './client.ts';
import { serveCapabilities, type CapabilityHandler } from './hostClient.ts';
import { useCoreClient } from './runClient.ts';

const RESTART_DELAY_MS = 1000;
let mainConnection: ReturnType<typeof connectCore> | undefined;

export interface StartCoreOptions {
  isTrusted: (url: string) => boolean;
  /** Page origins Core accepts; Electron reports a `file://` page as `file://`. */
  origins: ReadonlyArray<string>;
  capabilities: { names: ReadonlyArray<Capabilities.CapabilityName>; handle: CapabilityHandler };
}

/**
 * Main's side: forks Core on a loopback port with a fresh token, restarts it on the same port when it exits, connects
 * main as the client serving `capabilities`, and sends every trusted page its socket URL after each load (`core:url`).
 * Clients redial on their own, so a restart needs nothing from here beyond the respawn.
 */
export function startCore({ isTrusted, origins, capabilities }: StartCoreOptions) {
  const token = randomBytes(32).toString('base64url');
  const port = freePort();
  let core: UtilityProcess | undefined;
  let isQuitting = false;

  // A call made before a client's first open fails instead of waiting, so pages get the URL once Core answers main.
  let isReady: Promise<number> | undefined;
  const ready = () => (isReady ??= port.then(async (port) => (await pingUntilUp(), port)));
  const sendUrl = (contents: WebContents) =>
    void ready().then((port) => {
      if (contents.isDestroyed() || !isTrusted(contents.getURL())) return;
      contents.send('core:url', coreUrl(port, token, contents.id));
    });
  app.on('browser-window-created', (_event, win) => win.webContents.on('did-finish-load', () => sendUrl(win.webContents)));
  app.on('will-quit', () => {
    isQuitting = true;
    core?.kill();
  });

  void port.then((port) => {
    const env = {
      ...process.env,
      MOCHI_LOG_FILE: path.join(app.getPath('logs'), 'mochi.log'),
      MOCHI_CORE_PORT: String(port),
      MOCHI_CORE_TOKEN: token,
      MOCHI_CORE_ORIGINS: origins.join(','),
    };
    const spawn = () => {
      // Bundled into dist-electron/main.js, beside the `core` entry.
      core = utilityProcess.fork(path.join(import.meta.dirname, 'core.js'), [], { serviceName: 'Mochi Core', env });
      core.once('exit', (code) => {
        if (isQuitting) return;
        setTimeout(() => {
          spawn();
          logToCore('Warn', `Core exited (${code}), restarted`);
        }, RESTART_DELAY_MS);
      });
    };
    spawn();
    mainConnection = connectCore(coreUrl(port, token));
    useCoreClient(mainConnection.then(({ client }) => client));
    void mainConnection.then(({ client }) => Effect.runFork(serveCapabilities(client, capabilities.names, capabilities.handle)));
  });
}

const pingUntilUp = async () => {
  const { client } = await mainConnection!;
  await Effect.runPromise(client.ping().pipe(Effect.retry(Schedule.spaced(100))));
};

// ponytail: another process could take the port between this probe and Core's bind, and Core would keep failing to start.
// Upgrade path: Core binds port 0 and reports the bound port to main, which then rebroadcasts the URL after each restart.
function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/** Core's RPC client once main is connected, for main's own calls to Core's procedures. */
export const coreClient = async () => (await mainConnection!).client;

/** Main's log lines go to Core's file, retried for 5s while Core restarts; after that they go to main's stderr. */
export function logToCore(level: 'Debug' | 'Info' | 'Warn' | 'Error', message: string) {
  void mainConnection
    ?.then(({ client }) => Effect.runPromise(client.log({ level, source: 'main', message }).pipe(Effect.retry({ times: 50, schedule: Schedule.spaced(100) }))))
    .catch((error: unknown) => console.error(`Core is unreachable; ${level}: ${message}`, error));
}
