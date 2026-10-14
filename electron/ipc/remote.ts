import type { CommandResult, RemoteHost, RemoteSettings } from '../../src/host/types/remote.ts';
import { isScopes } from '../remote/protocol.ts';
import { answerApproval, answerCommand, answerSnapshot, forgetMachine, otherMachines, pair, pushAction, remoteStatus, removeDevice, setDeviceScopes, setRemote } from '../remote/index.ts';
import { integer, record, string, type Handlers } from './handlers.ts';

const MAX_ACTION_CHARS = 64 * 1024 * 1024;
const MAX_NAME = 64;

export const remote = {
  async status() {
    return remoteStatus();
  },
  async set(_sender, patch) {
    const p = record(patch, 'patch');
    const next: Partial<RemoteSettings> = {};
    if (p.isEnabled !== undefined) next.isEnabled = boolean(p.isEnabled, 'isEnabled');
    if (p.allowsNetwork !== undefined) next.allowsNetwork = boolean(p.allowsNetwork, 'allowsNetwork');
    if (p.machineName !== undefined) next.machineName = string(p.machineName, 'machineName', MAX_NAME).trim();
    if (p.reachesAnywhere !== undefined) next.reachesAnywhere = boolean(p.reachesAnywhere, 'reachesAnywhere');
    return setRemote(next);
  },
  async push(sender, epoch, seq, action) {
    pushAction(sender, string(epoch, 'epoch', 64), integer(seq, 'seq', 1, Number.MAX_SAFE_INTEGER), JSON.parse(string(action, 'action', MAX_ACTION_CHARS)));
  },
  async snapshot(sender, requestId, epoch, seq, saved) {
    answerSnapshot(sender, string(requestId, 'requestId', 64), string(epoch, 'epoch', 64), integer(seq, 'seq', 0, Number.MAX_SAFE_INTEGER), JSON.parse(string(saved, 'saved', MAX_ACTION_CHARS)));
  },
  async commandResult(sender, id, result) {
    const r = record(result, 'result');
    const checked: CommandResult = r.isOk === true ? { isOk: true } : { isOk: false, error: string(r.error, 'error') };
    answerCommand(sender, string(id, 'id', 128), checked);
  },
  async removeDevice(_sender, id) {
    return removeDevice(string(id, 'id', 64));
  },
  async setDeviceScopes(_sender, id, scopes) {
    if (!isScopes(scopes)) throw new TypeError('scopes must be a list of known scopes');
    return setDeviceScopes(string(id, 'id', 64), [...new Set(scopes)]);
  },
  async answerApproval(_sender, id, isAllowed) {
    answerApproval(string(id, 'id', 64), boolean(isAllowed, 'isAllowed'));
  },
  otherMachines: async () => otherMachines(),
  async pair(_sender, machineId) {
    await pair(string(machineId, 'machineId', 64));
  },
  async forgetMachine(_sender, machineId) {
    forgetMachine(string(machineId, 'machineId', 64));
  },
} satisfies Handlers<RemoteHost>;

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean`);
  return value;
}
