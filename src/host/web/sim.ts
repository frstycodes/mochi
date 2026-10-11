import type { SimHost } from '../types/sim.ts';

export const sim: SimHost = {
  async list() {
    return [
      { udid: 'A1B2C3D4-0000-4000-8000-000000000001', name: 'iPhone 17 Pro', runtime: 'iOS 26.0', state: 'Booted' },
      { udid: 'A1B2C3D4-0000-4000-8000-000000000002', name: 'iPad Air 13-inch', runtime: 'iOS 26.0', state: 'Shutdown' },
    ];
  },
  async boot() {},
};
