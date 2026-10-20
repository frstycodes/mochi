import type { GithubRef, RefState, RepoSlug } from '../../chat/refs.ts';
import type { Manifest } from './manifest.ts';
import type { PullRequest } from '../../model.ts';

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

/** A checkout's HEAD: `branch` is the short commit when `isDetached`, never to be shown as a branch name. */
export interface Head {
  branch: string;
  isDetached: boolean;
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
  /** Uncommitted changes in the checkout the list was read from; `files` is 0 when it's clean. */
  changes: ChangeStat;
  /** Current first, then most recently committed. */
  branches: Branch[];
}

export interface ChangeStat {
  files: number;
  added: number;
  removed: number;
}

/** What a branch switch does with uncommitted changes: throw, stash them (named), commit them as work in progress, carry them over, or throw them away. */
export interface SwitchOptions {
  changes: 'refuse' | 'stash' | 'commit' | 'bring' | 'discard';
}

/** How a thread's worktree is made: a new `branch` from `base` (default branch when unset), or an existing `branch` checked out. */
export interface WorktreeOptions {
  base?: string;
  isExisting?: boolean;
  /** Refuse a branch that already exists instead of checking it out. */
  isNew?: boolean;
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
  /** `base`: the branch it merges into; unset, GitHub's default branch. */
  createPr(cwd: string, pr: { title: string; body: string; base?: string }, githubUser?: string): Promise<string>;
  pr(cwd: string, githubUser?: string): Promise<PrInfo | null>;
  /**
   * The PRs in every state from the branch each of `worktrees` (one repo's) has checked out now, which the agent may have
   * switched: one `gh pr list` for them all. Never throws: no gh, no login or offline is none.
   */
  worktreePrs(worktrees: string[], githubUser?: string): Promise<{ worktree: string; pr: PullRequest }[]>;
  /** GitHub auto-merge for the cwd repo's PR `pr`: on with the first merge method the repo allows (squash, merge, rebase), or off. */
  setAutoMerge(cwd: string, pr: number, isOn: boolean, githubUser?: string): Promise<void>;
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
  /** Switches the project checkout to `branch` now; refuses a branch checked out elsewhere, naming where. */
  switchBranch(root: string, branch: string, options: SwitchOptions): Promise<void>;
  /** Renames the temp branch `expected` after the thread's title, unless HEAD changed or it was published. Returns the unique name, or null. */
  renameAutoBranch(cwd: string, expected: string, title: string): Promise<string | null>;
  worktrees(root: string): Promise<Worktree[]>;
  /** What the checkout at `cwd` (a worktree or the project folder) has checked out now. */
  head(cwd: string): Promise<Head>;
  removeWorktree(path: string): Promise<void>;
  diskUsage(path: string): Promise<number>;
  /** Snapshots the worktree's files (untracked included) under `refs/harness/checkpoints/<threadId>/<n>` without touching HEAD, index or files; resolves to the commit. */
  checkpoint(cwd: string, threadId: string, n: number | 'turn' | 'undo'): Promise<string>;
  /** Resets the worktree's branch and files to checkpoint `n`, after saving the current files as the `undo` checkpoint. */
  restoreCheckpoint(cwd: string, threadId: string, n: number | 'undo', hasUndo?: boolean): Promise<void>;
  /**
   * Puts only `paths` (relative to the worktree) back to checkpoint `n`, after saving the current files as the `undo` checkpoint: one
   * turn's file changes undone, nothing else touched. `n = 'undo'` puts those paths back as that save held them.
   */
  restoreFiles(cwd: string, threadId: string, n: number | 'undo', paths: string[]): Promise<void>;
  /** Before a rewind with files: the files checkpoint `n` changes back, and those changed since the agent's last turn ended (made outside the agent). */
  rewindPreview(cwd: string, threadId: string, n: number): Promise<RewindPreview>;
  /** What checkpoint `n` held against the branch's base: the thread's changes as they stood then. Throws when its files weren't saved. */
  checkpointDiff(cwd: string, threadId: string, n: number): Promise<GitDiff>;
  /** Files changed between checkpoint commit `from` and `to`, or the worktree now without `to`: one turn's changes, however they were made. */
  turnDiff(cwd: string, from: string, to?: string): Promise<DiffFile[]>;
  /** New worktree for `threadId` on `branch`, starting from `from`'s checkpoint, or from `cwd`'s HEAD without one. */
  forkWorktree(cwd: string, threadId: string, branch: string, from?: { threadId: string; n: number }): Promise<string>;
  /** Runs a goal criterion's check command in the worktree with your shell's PATH; never throws for a failing command. */
  runCheck(cwd: string, command: string): Promise<CheckRun>;
}

export interface CheckRun {
  /** null when it was killed (timed out). */
  exitCode: number | null;
  /** The output's tail, stdout and stderr interleaved. */
  output: string;
  ms: number;
}

export interface RewindPreview {
  /** Paths whose content differs between the checkpoint and the worktree now. */
  files: string[];
  /** Of those and others, paths changed since the agent's last turn ended: made by you or another program, lost on a rewind. */
  outside: string[];
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
  worktreePrs: 'invoke',
  setAutoMerge: 'invoke',
  ciLog: 'invoke',
  repoSlug: 'invoke',
  refStates: 'invoke',
  ghAccounts: 'invoke',
  sync: 'invoke',
  addWorktree: 'invoke',
  branches: 'invoke',
  branchNameError: 'invoke',
  switchBranch: 'invoke',
  renameAutoBranch: 'invoke',
  worktrees: 'invoke',
  head: 'invoke',
  removeWorktree: 'invoke',
  diskUsage: 'invoke',
  checkpoint: 'invoke',
  restoreCheckpoint: 'invoke',
  restoreFiles: 'invoke',
  rewindPreview: 'invoke',
  checkpointDiff: 'invoke',
  turnDiff: 'invoke',
  forkWorktree: 'invoke',
  runCheck: 'invoke',
} satisfies Manifest<GitHost>;
