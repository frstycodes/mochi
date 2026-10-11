import type { BrowserHost } from '../types/browser.ts';

let nextId = 0;

export const browser: BrowserHost = {
  async create() {
    return { id: `view-${++nextId}` };
  },
  async navigate() {},
};
