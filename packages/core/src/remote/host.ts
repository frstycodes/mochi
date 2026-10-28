import type { RemoteHost } from '../../../../apps/desktop/src/host/types/remote.ts';
import type { HostMethods } from '../hostMethods.ts';
import type { Remote } from './service.ts';

/** Main keeps the follower side: the computers this one follows, their cached threads, and a device's command run in its window. */
export type InMain =
  | 'commandResult'
  | 'machines'
  | 'follow'
  | 'cacheMachine'
  | 'cachedMachines'
  | 'command';

/** `host.remote`: Settings › Remote access and who this computer trusts, served by Core's `Remote`. */
export const remoteHost = (remote: Remote['Service']) =>
  ({
    status: async () => remote.status(),
    set: (_caller, patch) =>
      remote.set({
        ...patch,
        ...(patch.machineName !== undefined && {
          machineName: patch.machineName.trim(),
        }),
      }),
    removeMember: (_caller, id) => remote.removeMember(id),
    setDeviceScopes: async (_caller, id, scopes) =>
      remote.setDeviceScopes(id, [...new Set(scopes)]),
    answerApproval: async (_caller, id, isAllowed) =>
      remote.answerApproval(id, isAllowed),
    otherMachines: () => remote.otherMachines(),
    join: (_caller, machineId) => remote.join(machineId),
  }) satisfies HostMethods<Omit<RemoteHost, InMain>>;
