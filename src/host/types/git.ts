import type { Manifest } from './manifest.ts';

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked';
}

export interface GitStatus {
  branch: string;
  files: GitFileStatus[];
}

/** `branch`: the worktree (committed or not) against its merge base with the base branch. `uncommitted`: staged and unstaged changes. */
export type DiffScope = 'branch' | 'uncommitted';

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

export interface DiffHunk {
  header: string;
  /** File header plus this hunk: a complete patch `git apply` accepts on its own. */
  patch: string;
  added: number;
  removed: number;
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  kind: ChangeKind;
  staged: boolean;
  binary: boolean;
  added: number;
  removed: number;
  patch: string;
  hunks: DiffHunk[];
}

export interface GitDiff {
  branch: string;
  base: string;
  files: DiffFile[];
}

/** One file, or one hunk of it when `patch` is set. */
export interface ChangeTarget {
  path: string;
  staged: boolean;
  untracked?: boolean;
  patch?: string;
}

export type CheckState = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';

export interface PrCheck {
  name: string;
  state: CheckState;
  link?: string;
}

export interface PrInfo {
  number: number;
  url: string;
  state: string;
  checks: PrCheck[];
}

export interface Worktree {
  path: string;
  branch: string | null;
  head: string;
}

export interface SyncResult {
  base: string;
  conflicts: string[];
}

export interface GitHost {
  status(cwd: string): Promise<GitStatus>;
  diff(cwd: string, scope: DiffScope): Promise<GitDiff>;
  stage(cwd: string, target: ChangeTarget): Promise<void>;
  unstage(cwd: string, target: ChangeTarget): Promise<void>;
  revert(cwd: string, target: ChangeTarget): Promise<void>;
  commit(cwd: string, message: string): Promise<string>;
  push(cwd: string): Promise<void>;
  createPr(cwd: string, pr: { title: string; body: string }): Promise<string>;
  pr(cwd: string): Promise<PrInfo | null>;
  sync(cwd: string): Promise<SyncResult>;
  addWorktree(root: string, threadId: string, branch: string): Promise<string>;
  worktrees(root: string): Promise<Worktree[]>;
  removeWorktree(path: string): Promise<void>;
  diskUsage(path: string): Promise<number>;
}

export const gitMethods = {
  status: 'invoke',
  diff: 'invoke',
  stage: 'invoke',
  unstage: 'invoke',
  revert: 'invoke',
  commit: 'invoke',
  push: 'invoke',
  createPr: 'invoke',
  pr: 'invoke',
  sync: 'invoke',
  addWorktree: 'invoke',
  worktrees: 'invoke',
  removeWorktree: 'invoke',
  diskUsage: 'invoke',
} satisfies Manifest<GitHost>;
