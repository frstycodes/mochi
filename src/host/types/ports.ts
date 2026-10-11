import type { Manifest } from './manifest.ts';

export interface ListeningPort {
  port: number;
  pid: number;
  command: string;
}

export interface PortsHost {
  list(): Promise<ListeningPort[]>;
  kill(port: number): Promise<void>;
}

export const portsMethods = {
  list: 'invoke',
  kill: 'invoke',
} satisfies Manifest<PortsHost>;
