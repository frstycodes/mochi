import { app, MessageChannelMain, type WebContents } from 'electron';
import { Effect, Fiber, Layer, Queue } from 'effect';
import { layerHost } from '@mochi/core/hostServer';
import type { CorePort } from '@mochi/core/transport';
import type { HostBridge, Namespace } from '../../src/host/types/index.ts';
import type { Handlers } from './handlers.ts';
import { account } from './account.ts';
import { agent } from './agent.ts';
import { browser } from './browser.ts';
import { data } from './data.ts';
import { fs } from './fs.ts';
import { git } from './git.ts';
import { library } from './library.ts';
import { notify } from './notify.ts';
import { ports } from './ports.ts';
import { projects } from './projects.ts';
import { pty } from './pty.ts';
import { remote } from './remote.ts';
import { schedule } from './schedule.ts';
import { settings } from './settings.ts';
import { sim } from './sim.ts';
import { themes } from './themes.ts';
import { usage } from './usage.ts';
import { windows } from './windows.ts';

const handlers = { pty, git, fs, ports, sim, browser, notify, windows, agent, settings, data, schedule, themes, remote, account, projects, library, usage } satisfies {
  [K in Namespace]: Handlers<HostBridge[K]>;
};

type Handler = (sender: WebContents, ...args: unknown[]) => Promise<unknown>;

/**
 * Each trusted window gets its own RPC server, so a handler knows its sender, and a port after every load.
 * Only a page that passed `isTrustedUrl` ever receives one: that, and decoding with `@mochi/schema`, is what vets a call.
 */
export function registerIpc(isTrustedUrl: (url: string) => boolean) {
  app.on('browser-window-created', (_event, win) => serve(win.webContents, isTrustedUrl));
}

function serve(contents: WebContents, isTrustedUrl: (url: string) => boolean) {
  const ports = Effect.runSync(Queue.unbounded<CorePort>());
  const call = (tag: string, args: ReadonlyArray<unknown>) => {
    const [namespace, method] = tag.split('.') as [Namespace, string];
    return (handlers[namespace] as Record<string, Handler>)[method]!(contents, ...args);
  };
  const server = Effect.runFork(Layer.launch(layerHost(ports, call)));
  contents.once('destroyed', () => void Effect.runPromise(Fiber.interrupt(server)));
  contents.on('did-finish-load', () => {
    if (!isTrustedUrl(contents.getURL())) return;
    const { port1, port2 } = new MessageChannelMain();
    Queue.offerUnsafe(ports, port1);
    contents.postMessage('host:port', null, [port2]);
  });
}
