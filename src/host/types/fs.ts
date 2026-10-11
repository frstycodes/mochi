import type { Manifest } from './manifest.ts';

export interface DirEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
}

export interface FsHost {
  readDir(path: string): Promise<DirEntry[]>;
  readFile(path: string): Promise<string>;
}

export const fsMethods = {
  readDir: 'invoke',
  readFile: 'invoke',
} satisfies Manifest<FsHost>;
