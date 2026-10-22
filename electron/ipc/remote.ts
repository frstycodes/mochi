import type { RemoteHost } from '../../src/host/types/remote.ts';
import { parseCommand } from '../remote/protocol.ts';
import { answerApproval, answerCommand, answerSnapshot, cachedMachines, cacheMachine, commandMachine, follow, followedMachines, join, otherMachines, pushAction, remoteStatus, removeMember, setDeviceScopes, setRemote } from '../remote/index.ts';
import type { Handlers } from './handlers.ts';

export const remote = {
  async status() {
    return remoteStatus();
  },
  async set(_sender, patch) {
    return setRemote({ ...patch, ...(patch.machineName !== undefined && { machineName: patch.machineName.trim() }) });
  },
  async push(sender, epoch, seq, action) {
    pushAction(sender, epoch, seq, JSON.parse(action));
  },
  async snapshot(sender, requestId, epoch, seq, saved) {
    answerSnapshot(sender, requestId, epoch, seq, JSON.parse(saved));
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
  async command(_sender, machineId, command) {
    // The same check a machine runs on a device's frame, so nothing malformed leaves this computer.
    const frame = parseCommand(JSON.stringify({ type: 'command', id: 'renderer', command }));
    if (typeof frame === 'string') throw new TypeError(frame);
    return commandMachine(machineId, frame.command);
  },
} satisfies Handlers<RemoteHost>;
