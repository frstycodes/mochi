import {
  accountMethods,
  type AccountHost,
} from '@mochi/domain/host/types/account';
import { agentMethods, type AgentHost } from './agent.ts';
import { dataMethods, type DataHost } from './data.ts';
import {
  browserMethods,
  type BrowserHost,
} from '@mochi/domain/host/types/browser';
import { fsMethods, type FsHost } from '@mochi/domain/host/types/fs';
import { gitMethods, type GitHost } from './git.ts';
import { libraryMethods, type LibraryHost } from './library.ts';
import type { Manifest } from '@mochi/domain/host/types/manifest';
import { notifyMethods, type NotifyHost } from './notify.ts';
import { portsMethods, type PortsHost } from '@mochi/domain/host/types/ports';
import {
  projectsMethods,
  type ProjectsHost,
} from '@mochi/domain/host/types/projects';
import { ptyMethods, type PtyHost } from '@mochi/domain/host/types/pty';
import { remoteMethods, type RemoteHost } from './remote.ts';
import { scheduleMethods, type ScheduleHost } from './schedule.ts';
import { settingsMethods, type SettingsHost } from './settings.ts';
import { simMethods, type SimHost } from '@mochi/domain/host/types/sim';
import {
  themesMethods,
  type ThemesHost,
} from '@mochi/domain/host/types/themes';
import { usageMethods, type UsageHost } from './usage.ts';
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
  account: AccountHost;
  projects: ProjectsHost;
  library: LibraryHost;
  usage: UsageHost;
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
  account: accountMethods,
  projects: projectsMethods,
  library: libraryMethods,
  usage: usageMethods,
} satisfies { [K in Namespace]: Manifest<HostBridge[K]> };
