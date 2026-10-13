import type { RemoteHost } from '../types/remote.ts';

const OFF = { settings: { isEnabled: false, allowsNetwork: false, machineName: '' }, hostName: 'This browser', addresses: [], devices: [] };

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
};
