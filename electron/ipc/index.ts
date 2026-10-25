import { webContents } from 'electron';
import { open, seal } from '../secrets';
import { Schema } from 'effect';
import { Capabilities, definitionOf, Relay } from '@mochi/schema';
import type { CapabilityHandler } from '@mochi/core/hostClient';
import type { HostBridge, Namespace } from '../../src/host/types/index.ts';
import type { RemoteCommandRequest } from '../../src/host/types/remote.ts';
import { runDeviceCommand } from '../remote/index.ts';
import { processMetrics } from '../metrics.ts';
import { mainWindow } from '../window.ts';
import type { Handlers } from './handlers.ts';
import { account } from './account.ts';
import { mainForAgents } from '../agents/events.ts';
import { browser } from './browser.ts';
import { data } from './data.ts';
import { fs } from './fs.ts';
import { git, type CoreServed } from './git.ts';
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

// `agent` is served by Core (packages/core/src/agents/handlers.ts); main never gets those calls.
const handlers = {
  pty,
  git,
  fs,
  ports,
  sim,
  browser,
  notify,
  windows,
  settings,
  data,
  schedule,
  themes,
  remote,
  account,
  projects,
  library,
  usage,
} satisfies {
  [K in Exclude<Namespace, 'agent'>]: Handlers<
    K extends 'git' ? Omit<HostBridge[K], CoreServed> : HostBridge[K]
  >;
};

type Handler = (
  sender: Electron.WebContents,
  ...args: unknown[]
) => Promise<unknown>;

const secureStorage = {
  encrypt: async (text: string) => seal(text),
  decrypt: async (base64: string) => open(base64),
};

/**
 * What main does for Core. A window's `host.*` call reaches Core over its socket, Core checks the token and scope and
 * decodes it, then hands it here JSON-encoded, with the window's id so the handler gets its sender.
 */
export const mainCapabilities = {
  names: [
    'host',
    'notify',
    'browserView',
    'sim',
    'secureStorage',
    'remote',
    'metrics',
    'main',
  ],
  handle: async ({ capability, method, args, windowId }) => {
    if (capability === 'main')
      return (
        mainForAgents[method as keyof typeof mainForAgents] as (
          ...args: unknown[]
        ) => Promise<unknown>
      )(...args);
    if (capability === 'remote') {
      const result = await runDeviceCommand(
        Schema.decodeUnknownSync(
          Schema.toCodecJson(Relay.RemoteCommandRequest),
        )(args[0]) as RemoteCommandRequest,
      );
      return Schema.encodeUnknownSync(Schema.toCodecJson(Relay.CommandResult))(
        result,
      );
    }
    if (capability === 'metrics')
      return Schema.encodeUnknownSync(
        Schema.toCodecJson(Capabilities.metricsMethods.processes.output),
      )(processMetrics());
    if (capability === 'secureStorage') {
      const { input } =
        Capabilities.secureStorageMethods[method as keyof typeof secureStorage];
      const [text] = Schema.decodeUnknownSync(input)(args);
      return secureStorage[method as keyof typeof secureStorage](text);
    }
    const { input, output } = definitionOf(method) as {
      input: Schema.Codec<ReadonlyArray<unknown>, unknown>;
      output: Schema.Codec<unknown, unknown>;
    };
    const sender =
      (windowId === undefined ? undefined : webContents.fromId(windowId)) ??
      mainWindow()?.webContents;
    if (!sender) throw new Error(`No window to run ${method} for`);
    const [namespace, name] = method.split('.') as [
      Exclude<Namespace, 'agent'>,
      string,
    ];
    const result = await (handlers[namespace] as Record<string, Handler>)[
      name
    ]!(sender, ...Schema.decodeUnknownSync(Schema.toCodecJson(input))(args));
    return Schema.encodeUnknownSync(Schema.toCodecJson(output))(result);
  },
} satisfies {
  names: ReadonlyArray<Capabilities.CapabilityName>;
  handle: CapabilityHandler;
};
