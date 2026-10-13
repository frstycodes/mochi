import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { manifest, type HostBridge, type Namespace } from '../../src/host/types/index.ts';
import type { Handlers } from './handlers.ts';
import { agent } from './agent.ts';
import { browser } from './browser.ts';
import { data } from './data.ts';
import { fs } from './fs.ts';
import { git } from './git.ts';
import { notify } from './notify.ts';
import { ports } from './ports.ts';
import { pty } from './pty.ts';
import { schedule } from './schedule.ts';
import { settings } from './settings.ts';
import { sim } from './sim.ts';
import { themes } from './themes.ts';
import { windows } from './windows.ts';

const handlers = { pty, git, fs, ports, sim, browser, notify, windows, agent, settings, data, schedule, themes } satisfies {
  [K in Namespace]: Handlers<HostBridge[K]>;
};

export function registerIpc(isTrustedUrl: (url: string) => boolean) {
  for (const [ns, methods] of Object.entries(manifest)) {
    for (const [method, kind] of Object.entries(methods)) {
      if (kind !== 'invoke') continue;
      const handler = (handlers[ns as Namespace] as Record<string, (...args: unknown[]) => Promise<unknown>>)[method];
      ipcMain.handle(`${ns}:${method}`, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
        if (!isTrustedUrl(event.senderFrame?.url ?? '')) throw new Error(`${ns}.${method}: untrusted sender`);
        return handler(event.sender, ...args);
      });
    }
  }
}
