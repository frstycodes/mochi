import { agentMethods, type AgentHost } from './agent.ts';
import { dataMethods, type DataHost } from './data.ts';
import { browserMethods, type BrowserHost } from './browser.ts';
import { fsMethods, type FsHost } from './fs.ts';
import { gitMethods, type GitHost } from './git.ts';
import type { Manifest } from './manifest.ts';
import { notifyMethods, type NotifyHost } from './notify.ts';
import { portsMethods, type PortsHost } from './ports.ts';
import { ptyMethods, type PtyHost } from './pty.ts';
import { remoteMethods, type RemoteHost } from './remote.ts';
import { scheduleMethods, type ScheduleHost } from './schedule.ts';
import { settingsMethods, type SettingsHost } from './settings.ts';
import { simMethods, type SimHost } from './sim.ts';
import { themesMethods, type ThemesHost } from './themes.ts';
import { windowsMethods, type WindowsHost } from './windows.ts';

export interface HostBridge {
  pty: PtyHost;
  git: GitHost;
  fs: FsHost;
  ports: PortsHost;
  sim: SimHost;
  browser: BrowserHost;
  notify: NotifyHost;
  windows: WindowsHost;
  agent: AgentHost;
  settings: SettingsHost;
  data: DataHost;
  schedule: ScheduleHost;
  themes: ThemesHost;
  remote: RemoteHost;
}

export type Namespace = keyof HostBridge;

// The preload exposes exactly these methods and the main process registers exactly these channels (`<namespace>:<method>`).
export const manifest = {
  pty: ptyMethods,
  git: gitMethods,
  fs: fsMethods,
  ports: portsMethods,
  sim: simMethods,
  browser: browserMethods,
  notify: notifyMethods,
  windows: windowsMethods,
  agent: agentMethods,
  settings: settingsMethods,
  data: dataMethods,
  schedule: scheduleMethods,
  themes: themesMethods,
  remote: remoteMethods,
} satisfies { [K in Namespace]: Manifest<HostBridge[K]> };
