import { account as desktopAccount } from './desktop/account.ts';
import { updates as desktopUpdates } from './desktop/updates.ts';
import { agent as desktopAgent } from './desktop/agent.ts';
import { data as desktopData } from './desktop/data.ts';
import { browser as desktopBrowser } from './desktop/browser.ts';
import { fs as desktopFs } from './desktop/fs.ts';
import { git as desktopGit } from './desktop/git.ts';
import { notify as desktopNotify } from './desktop/notify.ts';
import { ports as desktopPorts } from './desktop/ports.ts';
import { projects as desktopProjects } from './desktop/projects.ts';
import { pty as desktopPty } from './desktop/pty.ts';
import { remote as desktopRemote } from './desktop/remote.ts';
import { schedule as desktopSchedule } from './desktop/schedule.ts';
import { settings as desktopSettings } from './desktop/settings.ts';
import { sim as desktopSim } from './desktop/sim.ts';
import { themes as desktopThemes } from './desktop/themes.ts';
import { windows as desktopWindows } from './desktop/windows.ts';
import { usage as desktopUsage } from './desktop/usage.ts';
import type { HostBridge, Namespace } from './types/index.ts';
import { account as webAccount } from './web/account.ts';
import { updates as webUpdates } from './web/updates.ts';
import { agent as webAgent } from './web/agent.ts';
import { data as webData } from './web/data.ts';
import { browser as webBrowser } from './web/browser.ts';
import { fs as webFs } from './web/fs.ts';
import { git as webGit } from './web/git.ts';
import { notify as webNotify } from './web/notify.ts';
import { ports as webPorts } from './web/ports.ts';
import { projects as webProjects } from './web/projects.ts';
import { pty as webPty } from './web/pty.ts';
import { remote as webRemote } from './web/remote.ts';
import { schedule as webSchedule } from './web/schedule.ts';
import { settings as webSettings } from './web/settings.ts';
import { sim as webSim } from './web/sim.ts';
import { themes as webThemes } from './web/themes.ts';
import { windows as webWindows } from './web/windows.ts';
import { usage as webUsage } from './web/usage.ts';

export type { HostBridge, Namespace } from './types/index.ts';

type Registry = { [K in Namespace]: { web: HostBridge[K]; desktop: () => HostBridge[K] } };

// Desktop impls are getters so the web build never touches window.harnessHost.
// Annotated, not `satisfies`: `pick` needs the mapped type to correlate `registry[ns]` with `HostBridge[K]`.
export const registry: Registry = {
  pty: { web: webPty, desktop: desktopPty },
  git: { web: webGit, desktop: desktopGit },
  fs: { web: webFs, desktop: desktopFs },
  ports: { web: webPorts, desktop: desktopPorts },
  sim: { web: webSim, desktop: desktopSim },
  browser: { web: webBrowser, desktop: desktopBrowser },
  notify: { web: webNotify, desktop: desktopNotify },
  windows: { web: webWindows, desktop: desktopWindows },
  agent: { web: webAgent, desktop: desktopAgent },
  settings: { web: webSettings, desktop: desktopSettings },
  data: { web: webData, desktop: desktopData },
  schedule: { web: webSchedule, desktop: desktopSchedule },
  themes: { web: webThemes, desktop: desktopThemes },
  remote: { web: webRemote, desktop: desktopRemote },
  account: { web: webAccount, desktop: desktopAccount },
  updates: { web: webUpdates, desktop: desktopUpdates },
  projects: { web: webProjects, desktop: desktopProjects },
  usage: { web: webUsage, desktop: desktopUsage },
};

const isDesktop = typeof window !== 'undefined' && !!window.harnessHost;

const pick = <K extends Namespace>(ns: K): HostBridge[K] => (isDesktop ? registry[ns].desktop() : registry[ns].web);

export const host = {
  isDesktop,
  pty: pick('pty'),
  git: pick('git'),
  fs: pick('fs'),
  ports: pick('ports'),
  sim: pick('sim'),
  browser: pick('browser'),
  notify: pick('notify'),
  windows: pick('windows'),
  agent: pick('agent'),
  settings: pick('settings'),
  data: pick('data'),
  schedule: pick('schedule'),
  themes: pick('themes'),
  remote: pick('remote'),
  account: pick('account'),
  updates: pick('updates'),
  projects: pick('projects'),
  usage: pick('usage'),
} satisfies HostBridge & { isDesktop: boolean };
