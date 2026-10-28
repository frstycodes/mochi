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
import { mainForAgents } from '../agents/events.ts';
import { browser } from './browser.ts';
import { data } from './data.ts';
import { fs } from './fs.ts';
import type { InMain as DataInMain } from '@mochi/core/data/host';
import type { InMain as FsInMain } from '@mochi/core/fs/host';
import type { InMain as LibraryInMain } from '@mochi/core/library/host';
import type { InMain as SettingsInMain } from '@mochi/core/settings/host';
import type { InMain as ThemesInMain } from '@mochi/core/themes/host';
import { library } from './library.ts';
import { notify } from './notify.ts';
import { remote } from './remote.ts';
import { settings } from './settings.ts';
import { sim } from './sim.ts';
import { themes } from './themes.ts';
import { updates } from './updates.ts';
import { windows } from './windows.ts';

// Core serves these itself (packages/core/src/{agents,schedule,hosted.ts}); main never gets their calls.
type InCore =
  | 'agent'
  | 'schedule'
  | 'git'
  | 'projects'
  | 'ports'
  | 'usage'
  | 'pty'
  | 'account';

/** Main's part of a namespace Core serves the rest of. */
type InMain = {
  fs: FsInMain;
  data: DataInMain;
  themes: ThemesInMain;
  settings: SettingsInMain;
  library: LibraryInMain;
};

const handlers = {
  fs,
  sim,
  browser,
  notify,
  windows,
  settings,
  data,
  themes,
  remote,
  library,
  updates,
} satisfies {
  [K in Exclude<Namespace, InCore>]: Handlers<
    K extends keyof InMain
      ? Pick<HostBridge[K], InMain[K] & keyof HostBridge[K]>
      : HostBridge[K]
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
      Exclude<Namespace, InCore>,
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
