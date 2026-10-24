import type { RemoteHost } from '../../src/host/types/remote.ts';
import { answerApproval, answerCommand, cachedMachines, cacheMachine, commandMachine, follow, followedMachines, join, otherMachines, remoteStatus, removeMember, setDeviceScopes, setRemote } from '../remote/index.ts';
import type { Handlers } from './handlers.ts';

export const remote = {
  async status() {
    return remoteStatus();
  },
  async set(_sender, patch) {
    return setRemote({ ...patch, ...(patch.machineName !== undefined && { machineName: patch.machineName.trim() }) });
  },
  async commandResult(sender, id, result) {
    answerCommand(sender, id, result);
  },
  async removeMember(_sender, id) {
    return removeMember(id);
  },
  async setDeviceScopes(_sender, id, scopes) {
    return setDeviceScopes(id, [...new Set(scopes)]);
  },
  async answerApproval(_sender, id, isAllowed) {
    answerApproval(id, isAllowed);
  },
  otherMachines: async () => otherMachines(),
  async join(_sender, machineId) {
    await join(machineId);
  },
  machines: async () => followedMachines(),
  async cacheMachine(sender, machineId, saved) {
    cacheMachine(sender, machineId, saved);
  },
  cachedMachines: async () => cachedMachines(),
  async follow(sender) {
    follow(sender);
  },
  // Core decoded `command` with the same schema the machine's Core decodes it with, so nothing malformed leaves here.
  command: async (_sender, machineId, command) => commandMachine(machineId, command),
} satisfies Handlers<RemoteHost>;
