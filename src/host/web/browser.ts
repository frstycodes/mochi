import type { BrowserHost } from '../types/browser.ts';

let nextId = 0;

// The web build renders an iframe instead of a native view, so these only keep the contract callable.
export const browser: BrowserHost = {
  async create() {
    return { id: `view-${++nextId}` };
  },
  async destroy() {},
  async navigate() {},
  async command() {},
  async setBounds() {},
  async setZoom() {},
  async emulate() {},
  async devtools() {},
  async capture() {
    throw new Error('Screenshots need the desktop app');
  },
  async pick() {
    return null;
  },
  async cancelPick() {},
  onEvent() {
    return () => {};
  },
};
