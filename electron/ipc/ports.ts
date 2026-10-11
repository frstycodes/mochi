import type { PortsHost } from '../../src/host/types/ports.ts';
import { notImplemented, type Handlers } from './handlers.ts';

export const ports = {
  list: notImplemented('ports.list'),
  kill: notImplemented('ports.kill'),
} satisfies Handlers<PortsHost>;
