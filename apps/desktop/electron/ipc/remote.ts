import type { InMain } from '@mochi/core/remote/host';
import type { RemoteHost } from '../../src/host/types/remote.ts';
import {
  answerCommand,
  cachedMachines,
  cacheMachine,
  commandMachine,
  follow,
  followedMachines,
} from '../remote/index.ts';
import type { Handlers } from './handlers.ts';

/** Main's part of `host.remote`: following your other computers, and a device's command answered by the main window. */
export const remote = {
  async commandResult(sender, id, result) {
    answerCommand(sender, id, result);
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
  command: async (_sender, machineId, command) =>
    commandMachine(machineId, command),
} satisfies Handlers<Pick<RemoteHost, InMain>>;
