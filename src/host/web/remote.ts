import type { RemoteHost } from '../types/remote.ts';

const OFF = { settings: { isEnabled: false, allowsNetwork: false, machineName: '', reachesAnywhere: false, keepsAwake: true }, hostName: 'This browser', addresses: [], devices: [], members: [], isRemoved: false, relay: { status: 'off' as const }, isOnBattery: false };

// Devices control the desktop app; the web build has no server to reach.
export const remote: RemoteHost = {
  async status() {
    return OFF;
  },
  async set() {
    throw new Error('Devices need the desktop app');
  },
  onStatus: () => () => {},
  onCommand: () => () => {},
  async commandResult() {},
  async removeMember() {
    return OFF;
  },
  async setDeviceScopes() {
    return OFF;
  },
  onApproval: () => () => {},
  async answerApproval() {},
  async otherMachines() {
    return [];
  },
  async join() {
    throw new Error('Joining needs the desktop app');
  },
  async machines() {
    return [];
  },
  onMachines: () => () => {},
  async follow() {},
  onMachineFrame: () => () => {},
  onTerminalOutput: () => () => {},
  async cacheMachine() {},
  async cachedMachines() {
    return [];
  },
  async command() {
    return { isOk: false, error: 'Other computers need the desktop app' };
  },
};
