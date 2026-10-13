import type { GithubRef, RefState, RepoSlug } from '../../chat/refs.ts';
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
  title: string;
  state: string;
  checks: PrCheck[];
}

export interface Worktree {
  path: string;
  branch: string | null;
  head: string;
}

export interface Branch {
  /** Local `feat/x`, or remote `origin/feat/x`. */
  name: string;
  isRemote: boolean;
  /** Epoch ms of the tip commit. */
  committedAt: number;
  /** A local branch checked out in a worktree (the project's own checkout included): git allows only one. */
  worktree?: string;
}

export interface BranchList {
  /** null on a detached HEAD. */
  current: string | null;
  /** origin's default branch, else main or master. */
  defaultBranch: string;
  /** Uncommitted changes in the checkout the list was read from. */
  isDirty: boolean;
  /** Current first, then most recently committed. */
  branches: Branch[];
}

/** How a thread's worktree is made: a new `branch` from `base` (default branch when unset), or an existing `branch` checked out. */
export interface WorktreeOptions {
  base?: string;
  isExisting?: boolean;
}

export interface SyncResult {
  base: string;
  conflicts: string[];
}

export interface GhAccount {
  /** github.com, a GitHub Enterprise Cloud `*.ghe.com` host, or an Enterprise Server host. */
  host: string;
  login: string;
  /** The account gh uses on its host when no login is named. */
  isActive: boolean;
  /** False when gh holds a login whose token stopped working; `gh auth login` fixes it. */
  isValid: boolean;
}

export interface GitHost {
  status(cwd: string): Promise<GitStatus>;
  /** `base` overrides the default branch the `branch` scope diffs against (the thread's chosen base). */
  diff(cwd: string, scope: DiffScope, base?: string): Promise<GitDiff>;
  stage(cwd: string, target: ChangeTarget): Promise<void>;
  unstage(cwd: string, target: ChangeTarget): Promise<void>;
  revert(cwd: string, target: ChangeTarget): Promise<void>;
  commit(cwd: string, message: string): Promise<string>;
  /** With `githubUser`, pushes over HTTPS as that account (the profile's GitHub account); without, with your own git credentials. */
  push(cwd: string, githubUser?: string): Promise<void>;
  /** `githubUser` (`login` on github.com, `host/login` elsewhere) runs gh as the profile's GitHub account; omitted, gh's active account. */
  createPr(cwd: string, pr: { title: string; body: string }, githubUser?: string): Promise<string>;
  pr(cwd: string, githubUser?: string): Promise<PrInfo | null>;
  /** The tail of a failed GitHub Actions job's log, from the check's `link`; throws for a check that isn't an Actions job. */
  ciLog(cwd: string, checkLink: string, githubUser?: string): Promise<string>;
  /** origin's `owner/repo` when it's on github.com; null otherwise (no origin, another host, not a repo). */
  repoSlug(cwd: string): Promise<RepoSlug | null>;
  /** Live state of PRs and issues in one `gh api graphql` call, keyed by `refKey`. Never throws: refs gh can't read are left out. */
  refStates(cwd: string | null, refs: GithubRef[], githubUser?: string): Promise<Record<string, RefState>>;
  /** gh's logins on every host it knows, for picking a profile's account. Never carries tokens. */
  ghAccounts(): Promise<GhAccount[]>;
  sync(cwd: string, base?: string): Promise<SyncResult>;
  /** Refuses an existing branch that's checked out elsewhere, naming where. */
  addWorktree(root: string, threadId: string, branch: string, options?: WorktreeOptions): Promise<string>;
  /** The project's branches for the new-thread pickers. */
  branches(root: string): Promise<BranchList>;
  /** Why `name` can't be a new branch (`git check-ref-format`, already exists), or null. */
  branchNameError(root: string, name: string): Promise<string | null>;
  worktrees(root: string): Promise<Worktree[]>;
  removeWorktree(path: string): Promise<void>;
  diskUsage(path: string): Promise<number>;
  /** Snapshots the worktree's files (untracked included) under `refs/harness/checkpoints/<threadId>/<n>` without touching HEAD, index or files; resolves to the commit. */
  checkpoint(cwd: string, threadId: string, n: number): Promise<string>;
  /** Resets the worktree's branch and files to checkpoint `n`, after saving the current files as the `undo` checkpoint. */
  restoreCheckpoint(cwd: string, threadId: string, n: number | 'undo'): Promise<void>;
  /** What checkpoint `n` held against the branch's base: the thread's changes as they stood then. Throws when its files weren't saved. */
  checkpointDiff(cwd: string, threadId: string, n: number): Promise<GitDiff>;
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
  ciLog: 'invoke',
  repoSlug: 'invoke',
  refStates: 'invoke',
  ghAccounts: 'invoke',
  sync: 'invoke',
  addWorktree: 'invoke',
  branches: 'invoke',
  branchNameError: 'invoke',
  worktrees: 'invoke',
  removeWorktree: 'invoke',
  diskUsage: 'invoke',
  checkpoint: 'invoke',
  restoreCheckpoint: 'invoke',
  checkpointDiff: 'invoke',
  forkWorktree: 'invoke',
} satisfies Manifest<GitHost>;
