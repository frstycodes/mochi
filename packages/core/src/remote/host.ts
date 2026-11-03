import type { RemoteHost } from '../../../../apps/desktop/src/host/types/remote.ts';
import type { HostMethods } from '../hostMethods.ts';
import type { Remote } from './tag.ts';

/** Main keeps the follower side: the computers this one follows, their cached threads, and a device's command run in its window. */
export type InMain =
  | 'commandResult'
  | 'machines'
  | 'follow'
  | 'cacheMachine'
  | 'cachedMachines'
  | 'cacheCatalog'
  | 'cachedCatalog'
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
    diagnostics: () => remote.diagnostics(),
    join: (_caller, machineId) => remote.join(machineId),
    queueMail: (_caller, machineId, command) =>
      remote.queueMail(machineId, command),
    outbox: () => remote.outbox(),
    cancelMail: (_caller, machineId, id) => remote.cancelMail(machineId, id),
  }) satisfies HostMethods<Omit<RemoteHost, InMain>>;
