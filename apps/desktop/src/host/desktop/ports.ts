import type { PortsHost } from '@mochi/domain/host/types/ports';
import { desktopNamespace } from './rpc.ts';

export const ports = (): PortsHost => desktopNamespace('ports');
