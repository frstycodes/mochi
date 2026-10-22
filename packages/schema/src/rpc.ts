import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { agentRpc } from './agent.ts';
import { accountRpc } from './ipc/account.ts';
import { browserRpc } from './ipc/browser.ts';
import { dataRpc } from './ipc/data.ts';
import { fsRpc } from './ipc/fs.ts';
import { gitRpc } from './ipc/git.ts';
import { libraryRpc } from './ipc/library.ts';
import { notifyRpc } from './ipc/notify.ts';
import { portsRpc } from './ipc/ports.ts';
import { projectsRpc } from './ipc/projects.ts';
import { ptyRpc } from './ipc/pty.ts';
import { remoteRpc } from './ipc/remote.ts';
import { scheduleRpc } from './ipc/schedule.ts';
import { settingsRpc } from './ipc/settings.ts';
import { simRpc } from './ipc/sim.ts';
import { themesRpc } from './ipc/themes.ts';
import { usageRpc } from './ipc/usage.ts';
import { windowsRpc } from './ipc/windows.ts';

/** Every `host.<namespace>.<method>` and what it takes and returns; `on*` push channels have no `input`. */
export const hostMethods = {
  pty: ptyRpc,
  git: gitRpc,
  fs: fsRpc,
  ports: portsRpc,
  sim: simRpc,
  browser: browserRpc,
  notify: notifyRpc,
  windows: windowsRpc,
  agent: agentRpc,
  settings: settingsRpc,
  data: dataRpc,
  schedule: scheduleRpc,
  themes: themesRpc,
  remote: remoteRpc,
  account: accountRpc,
  projects: projectsRpc,
  library: libraryRpc,
  usage: usageRpc,
};

type Invoke = { readonly input: Schema.Top; readonly output: Schema.Top };

/** The tags of the RPCs, `<namespace>.<method>`, one per request/response method. */
export const hostTags = Object.entries(hostMethods).flatMap(([namespace, methods]) =>
  Object.entries(methods as Record<string, object>)
    .filter(([, definition]) => 'input' in definition)
    .map(([method]) => `${namespace}.${method}`),
);

/** The input and output schemas of `host.<namespace>.<method>`. */
export const definitionOf = (tag: string) => {
  const [namespace, method] = tag.split('.') as [keyof typeof hostMethods, string];
  return (hostMethods[namespace] as Record<string, object>)[method] as Invoke;
};

/** A failure crosses the socket as its message: the renderer rethrows it as an `Error` (`src/host/desktop/rpc.ts`). */
export class HostRpcs extends RpcGroup.make(
  ...hostTags.map((tag) => Rpc.make(tag, { payload: definitionOf(tag).input, success: definitionOf(tag).output, error: Schema.String })),
) {}
