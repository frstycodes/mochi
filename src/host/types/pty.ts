import type { Manifest } from './manifest.ts';

export interface PtySpawnOptions {
  cwd: string;
  cols: number;
  rows: number;
  command?: string;
}

export interface PtyData {
  id: string;
  data: string;
}

export interface PtyHost {
  spawn(options: PtySpawnOptions): Promise<{ id: string }>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  kill(id: string): Promise<void>;
  onData(listener: (event: PtyData) => void): () => void;
}

export const ptyMethods = {
  spawn: 'invoke',
  write: 'invoke',
  resize: 'invoke',
  kill: 'invoke',
  onData: 'event',
} satisfies Manifest<PtyHost>;
