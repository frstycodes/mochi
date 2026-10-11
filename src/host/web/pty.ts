import type { PtyData, PtyHost } from '../types/pty.ts';

const listeners = new Set<(event: PtyData) => void>();
const emit = (event: PtyData) => listeners.forEach((listener) => listener(event));
let nextId = 0;

// Echoes input back so a terminal UI has something to render in the web build.
export const pty: PtyHost = {
  async spawn({ cwd }) {
    const id = `pty-${++nextId}`;
    queueMicrotask(() => emit({ id, data: `${cwd} $ ` }));
    return { id };
  },
  async write(id, data) {
    emit({ id, data: data === '\r' ? '\r\nweb preview: no shell\r\n$ ' : data });
  },
  async resize() {},
  async kill() {},
  onData(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
