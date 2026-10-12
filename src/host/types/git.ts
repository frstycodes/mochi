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

export interface GhAccount {
  login: string;
  /** The account gh uses when no login is named. */
  isActive: boolean;
  /** False when gh holds a login whose token stopped working; `gh auth login` fixes it. */
  isValid: boolean;
}

export interface GitHost {
  status(cwd: string): Promise<GitStatus>;
  diff(cwd: string, scope: DiffScope): Promise<GitDiff>;
  stage(cwd: string, target: ChangeTarget): Promise<void>;
  unstage(cwd: string, target: ChangeTarget): Promise<void>;
  revert(cwd: string, target: ChangeTarget): Promise<void>;
  commit(cwd: string, message: string): Promise<string>;
  push(cwd: string): Promise<void>;
  /** `githubUser` runs gh as that login (the profile's GitHub account); omitted, gh uses its active account. */
  createPr(cwd: string, pr: { title: string; body: string }, githubUser?: string): Promise<string>;
  pr(cwd: string, githubUser?: string): Promise<PrInfo | null>;
  /** gh's logins on github.com, for picking a profile's account. Never carries tokens. */
  ghAccounts(): Promise<GhAccount[]>;
  sync(cwd: string): Promise<SyncResult>;
  addWorktree(root: string, threadId: string, branch: string): Promise<string>;
  worktrees(root: string): Promise<Worktree[]>;
  removeWorktree(path: string): Promise<void>;
  diskUsage(path: string): Promise<number>;
  /** Snapshots the worktree's files (untracked included) under `refs/harness/checkpoints/<threadId>/<n>` without touching HEAD, index or files; resolves to the commit. */
  checkpoint(cwd: string, threadId: string, n: number): Promise<string>;
  /** Resets the worktree's branch and files to checkpoint `n`, after saving the current files as the `undo` checkpoint. */
  restoreCheckpoint(cwd: string, threadId: string, n: number | 'undo'): Promise<void>;
  /** New worktree for `threadId` on `branch`, starting from `from`'s checkpoint, or from `cwd`'s HEAD without one. */
  forkWorktree(cwd: string, threadId: string, branch: string, from?: { threadId: string; n: number }): Promise<string>;
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
  ghAccounts: 'invoke',
  sync: 'invoke',
  addWorktree: 'invoke',
  worktrees: 'invoke',
  removeWorktree: 'invoke',
  diskUsage: 'invoke',
  checkpoint: 'invoke',
  restoreCheckpoint: 'invoke',
  forkWorktree: 'invoke',
} satisfies Manifest<GitHost>;
