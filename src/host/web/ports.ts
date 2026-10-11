import type { PortsHost } from '../types/ports.ts';

export const ports: PortsHost = {
  async list() {
    return [
      { port: 5173, pid: 48211, command: 'node vite' },
      { port: 3000, pid: 48302, command: 'node server.js' },
    ];
  },
  async kill() {},
};
