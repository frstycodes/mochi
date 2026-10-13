import type { CommandResult, RemoteHost, RemoteSettings } from '../../src/host/types/remote.ts';
import { answerCommand, answerSnapshot, pushAction, remoteStatus, setRemote } from '../remote/index.ts';
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
} satisfies Handlers<RemoteHost>;

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean`);
  return value;
}
