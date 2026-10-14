import type { RemoteHost } from '../types/remote.ts';

const OFF = { settings: { isEnabled: false, allowsNetwork: false, machineName: '', reachesAnywhere: false }, hostName: 'This browser', addresses: [], devices: [], pairedDevices: [], relay: { status: 'off' as const } };

// Devices control the desktop app; the web build has no server to reach.
export const remote: RemoteHost = {
  async status() {
    return OFF;
  },
  async set() {
    throw new Error('Devices need the desktop app');
  },
  onStatus: () => () => {},
  async push() {},
  async snapshot() {},
  onSnapshotRequest: () => () => {},
  onCommand: () => () => {},
  async commandResult() {},
  async removeDevice() {
    return OFF;
  },
  onApproval: () => () => {},
  async answerApproval() {},
  async otherMachines() {
    return [];
  },
  async pair() {
    throw new Error('Pairing needs the desktop app');
  },
  async forgetMachine() {},
};
