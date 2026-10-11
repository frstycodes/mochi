import type { PortsHost } from '../types/ports.ts';

const minutesAgo = (m: number) => Date.now() - m * 60_000;

export const ports: PortsHost = {
  async list() {
    return [
      { port: 3000, pid: 48302, command: 'node server.js', startedAt: minutesAgo(42) },
      { port: 5173, pid: 48211, command: 'node node_modules/.bin/vite', startedAt: minutesAgo(6) },
    ];
  },
  async kill() {},
  async allocate() {
    return 5300;
  },
  async targets() {
    return [
      { name: 'dev', command: 'pnpm run dev', source: 'package.json' },
      { name: 'harness-app', command: 'pnpm dev --port 5191 --strictPort', source: 'launch.json', port: 5191 },
    ];
  },
};
