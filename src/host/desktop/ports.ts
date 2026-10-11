import type { PortsHost } from '../types/ports.ts';
import { bridge } from './bridge.ts';

export const ports = (): PortsHost => bridge().ports;
