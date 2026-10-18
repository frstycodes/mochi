import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Branch, BranchList, ChangeStat, Head, SwitchOptions } from '../../src/host/types/git.ts';
import { listWorktrees, runGit } from './run.ts';
import { uniqueBranch } from '../../src/git/workspace.ts';

const MAX_BRANCHES = 500;
// Untracked files are read whole to count their lines; past this many the rest count as files only.
const MAX_UNTRACKED_READS = 200;

/** Local branches, then remote ones without a local namesake; current first, the rest most recently committed first. */
export async function listBranches(top: string): Promise<BranchList> {
  const [current, defaultBranch, refs, changes, worktrees] = await Promise.all([
    currentBranch(top).then((name) => name || null),
    baseRef(top),
    runGit(top, ['for-each-ref', '--sort=-committerdate', `--count=${MAX_BRANCHES}`, '--format=%(refname)%00%(committerdate:unix)', 'refs/heads', 'refs/remotes']),
    changeStat(top),
    listWorktrees(top),
  ]);
  const checkedOut = new Map(worktrees.flatMap((w) => (w.branch ? [[w.branch, w.path] as const] : [])));
  const all = refs
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, at] = line.split('\0');
      const isRemote = ref.startsWith('refs/remotes/');
      const name = ref.replace(/^refs\/(heads|remotes)\//, '');
      return { name, isRemote, committedAt: Number(at) * 1000, worktree: isRemote ? undefined : checkedOut.get(name) } satisfies Branch;
    })
    .filter((b) => !b.name.endsWith('/HEAD'));
  const locals = new Set(all.filter((b) => !b.isRemote).map((b) => b.name));
  const branches = all.filter((b) => !b.isRemote || !locals.has(b.name.slice(b.name.indexOf('/') + 1)));
  branches.sort((a, b) => Number(b.name === current) - Number(a.name === current));
  return { current, defaultBranch, changes, branches };
}

/** Why `name` can't be a new branch in the repo at `top`, or null when it can. */
export async function branchNameError(top: string, name: string) {
  if (!name.trim()) return 'Name the branch';
  const ok = await runGit(top, ['check-ref-format', '--branch', name]).then(
    () => true,
    () => false,
  );
  if (!ok) return `"${name}" isn't a valid branch name`;
  const exists = await runGit(top, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { okCodes: [1] }).then((s) => !!s.trim());
  return exists ? `A branch named ${name} already exists` : null;
}

/** Throws, naming the folder, when `branch` is checked out in any worktree of the repo (its main checkout included); git allows one checkout per branch. */
export async function assertFreeBranch(top: string, branch: string) {
  const worktrees = await listWorktrees(top);
  const at = worktrees.find((w) => w.branch === branch);
  if (at) throw new Error(`${branch} is already checked out in ${at.path}`);
}

/**
 * Switches the checkout at `top` to `branch` (a remote one gets a tracking branch). Uncommitted changes go by `changes`: `refuse`
 * throws, `stash` saves them in a named stash first (popped back if the switch fails), `commit` saves them as a work-in-progress
 * commit on the current branch (undone if the switch fails), `bring` is a plain `git switch` that carries them over and refuses on
 * conflict, `discard` resets tracked files and deletes untracked ones.
 */
export async function switchBranch(top: string, branch: string, { changes }: SwitchOptions) {
  const current = await currentBranch(top);
  const local = await localName(top, branch);
  if (current === local) return;
  await assertFreeBranch(top, local);
  const isDirty = (await runGit(top, ['status', '--porcelain=v1'])).trim() !== '';
  if (!isDirty || changes === 'bring') return void (await runGit(top, ['switch', local]));
  if (changes === 'refuse') throw new Error(`Can't switch to ${local}: the project folder has uncommitted changes. Commit or stash them first.`);
  if (changes === 'discard') {
    await runGit(top, ['reset', '--hard', 'HEAD']);
    await runGit(top, ['clean', '-fd']);
    return void (await runGit(top, ['switch', local]));
  }
  if (changes === 'commit') {
    await runGit(top, ['add', '--all']);
    await runGit(top, ['commit', '-m', `chore: save work in progress before switching to ${local}`]);
    // A mixed reset puts the files back as uncommitted changes, though what was staged before comes back unstaged.
    return switchOrUndo(top, local, ['reset', '--mixed', 'HEAD~1']);
  }
  await runGit(top, ['stash', 'push', '--include-untracked', '-m', `mochi: ${current || 'HEAD'} before switching to ${local}`]);
  return switchOrUndo(top, local, ['stash', 'pop']);
}

/** `git switch`, running `undo` before rethrowing when it fails, so the changes saved for the switch come back. */
async function switchOrUndo(top: string, branch: string, undo: string[]) {
  try {
    await runGit(top, ['switch', branch]);
  } catch (error) {
    await runGit(top, undo);
    throw error;
  }
}

/** Files changed since HEAD (untracked included) and their added and removed lines, like `git diff --stat`. */
export async function changeStat(top: string): Promise<ChangeStat> {
  const [numstat, untracked] = await Promise.all([
    // An unborn branch has no HEAD to diff against; its files all show as untracked or staged.
    runGit(top, ['diff', 'HEAD', '--numstat']).catch(() => ''),
    runGit(top, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const tracked = numstat.split('\n').filter(Boolean).map((line) => line.split('\t'));
  const newFiles = untracked.split('\0').filter(Boolean);
  const newLines = await Promise.all(newFiles.slice(0, MAX_UNTRACKED_READS).map((file) => lineCount(join(top, file))));
  return {
    files: tracked.length + newFiles.length,
    // Binary files print `-` for both counts.
    added: tracked.reduce((sum, [added]) => sum + (Number(added) || 0), 0) + newLines.reduce((a, b) => a + b, 0),
    removed: tracked.reduce((sum, [, removed]) => sum + (Number(removed) || 0), 0),
  };
}

/** Lines in a text file as git counts them (a last line without a newline counts); 0 for a binary or unreadable one. */
async function lineCount(path: string) {
  const text = await readFile(path, 'utf8').catch(() => '');
  if (!text || text.includes('\0')) return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/** What `top` has checked out: a branch by name, or the short commit of a detached HEAD, said as such. Throws before a first commit. */
export async function headOf(top: string): Promise<Head> {
  const branch = await currentBranch(top);
  if (branch) return { branch, isDetached: false };
  return { branch: (await runGit(top, ['rev-parse', '--short', 'HEAD'])).trim(), isDetached: true };
}

async function currentBranch(top: string) {
  return (await runGit(top, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { okCodes: [1] })).trim();
}

/** `origin/feat` → `feat` when there's no local `origin/feat`: git's own guess (`switch` / `worktree add`) makes the tracking branch. */
export async function localName(top: string, branch: string) {
  const isLocal = await runGit(top, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { okCodes: [1] }).then((s) => !!s.trim());
  if (isLocal) return branch;
  const isRemote = await runGit(top, ['rev-parse', '--verify', '--quiet', `refs/remotes/${branch}`], { okCodes: [1] }).then((s) => !!s.trim());
  return isRemote ? branch.slice(branch.indexOf('/') + 1) : branch;
}

/** origin's default branch, else a local main or master, else HEAD. */
export async function baseRef(top: string) {
  const remote = await runGit(top, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => '');
  if (remote.trim()) return remote.trim();
  for (const name of ['main', 'master']) {
    const found = await runGit(top, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { okCodes: [1] });
    if (found.trim()) return name;
  }
  return 'HEAD';
}

export async function renameAutoBranch(cwd: string, expected: string, name: string) {
  if ((await currentBranch(cwd)) !== expected) return null;
  const refs = await runGit(cwd, ['for-each-ref', '--format=%(refname:short)%00%(upstream)', 'refs/heads', 'refs/remotes']);
  const entries = refs.trim().split('\n').map((line) => line.split('\0'));
  if (entries.some(([ref, upstream]) => (ref === expected && upstream) || ref.endsWith(`/${expected}`))) return null;
  const taken = new Set(entries.map(([ref]) => ref).filter((ref) => ref !== expected));
  const branch = uniqueBranch(name, taken);
  if (branch !== expected) await runGit(cwd, ['branch', '-m', expected, branch]);
  return branch;
}
