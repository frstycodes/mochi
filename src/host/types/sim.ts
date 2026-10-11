import type { Manifest } from './manifest.ts';

export interface Simulator {
  udid: string;
  name: string;
  runtime: string;
  state: 'Booted' | 'Shutdown';
}

export interface SimHost {
  list(): Promise<Simulator[]>;
  boot(udid: string): Promise<void>;
}

export const simMethods = {
  list: 'invoke',
  boot: 'invoke',
} satisfies Manifest<SimHost>;
