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
  async mirror() {},
  async emulate() {},
  async devtools() {},
  async capture() {
    throw new Error('Screenshots need the desktop app');
  },
  async pick() {
    return null;
  },
  async cancelPick() {},
  async clearData() {
    throw new Error('Browsing data lives in the desktop app');
  },
  async snapshot() {
    throw new Error('Driving the browser needs the desktop app');
  },
  async act() {
    throw new Error('Driving the browser needs the desktop app');
  },
  async logs() {
    return [];
  },
  async eval() {
    throw new Error('Driving the browser needs the desktop app');
  },
  async waitFor() {
    throw new Error('Driving the browser needs the desktop app');
  },
  async answerDialog() {
    throw new Error('Driving the browser needs the desktop app');
  },
  async autoReload() {},
  async scroll() {
    return { x: 0, y: 0 };
  },
  async compareStart() {
    throw new Error('Comparing branches needs the desktop app');
  },
  async compareStop() {},
  async find() {},
  async stopFind() {},
  async menuCommand() {},
  async peek() {
    throw new Error('The web build has no native view to capture');
  },
  async openExternal(url) {
    window.open(url, '_blank', 'noopener');
  },
  async showDownload() {
    throw new Error('The web build saves no downloads');
  },
  async defaultBrowser() {
    return '';
  },
  // GAP: engines don't allow cross-origin requests, so the web build gets no search suggestions.
  async suggest() {
    return [];
  },
  onEvent() {
    return () => {};
  },
};
