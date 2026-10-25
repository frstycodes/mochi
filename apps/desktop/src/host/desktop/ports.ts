import type { PortsHost } from '../types/ports.ts';
import { desktopNamespace } from './rpc.ts';

export const ports = (): PortsHost => desktopNamespace('ports');
