import type { Manifest } from './manifest.ts';

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked';
}

export interface GitStatus {
  branch: string;
  files: GitFileStatus[];
}

export interface GitHost {
  status(cwd: string): Promise<GitStatus>;
  diff(cwd: string): Promise<string>;
}

export const gitMethods = {
  status: 'invoke',
  diff: 'invoke',
} satisfies Manifest<GitHost>;
