import type { DataHost } from '../types/data.ts';

// The web build and the artifact run on demo data that starts fresh on every load.
export const data: DataHost = {
  async load() {
    return null;
  },
  async save() {},
};
