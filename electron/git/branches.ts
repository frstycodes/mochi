import { parseWorktrees } from '../../src/git/parse.ts';
import type { Branch, BranchList } from '../../src/host/types/git.ts';
import { runGit } from './run.ts';

const MAX_BRANCHES = 500;

/** Local branches, then remote ones without a local namesake; current first, the rest most recently committed first. */
export async function listBranches(top: string): Promise<BranchList> {
  const [current, defaultBranch, refs, porcelain, worktrees] = await Promise.all([
    runGit(top, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { okCodes: [1] }).then((s) => s.trim() || null),
    baseRef(top),
    runGit(top, ['for-each-ref', '--sort=-committerdate', `--count=${MAX_BRANCHES}`, '--format=%(refname)%00%(committerdate:unix)', 'refs/heads', 'refs/remotes']),
    runGit(top, ['status', '--porcelain=v1', '--untracked-files=normal']),
    runGit(top, ['worktree', 'list', '--porcelain']).then(parseWorktrees),
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
  return { current, defaultBranch, isDirty: porcelain.trim() !== '', branches };
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
  const worktrees = parseWorktrees(await runGit(top, ['worktree', 'list', '--porcelain']));
  const at = worktrees.find((w) => w.branch === branch);
  if (at) throw new Error(`${branch} is already checked out in ${at.path}`);
}

/** Switches the checkout at `top` to `branch` (a remote one gets a tracking branch); refuses with uncommitted changes, so nothing of yours is carried over or lost. */
export async function switchBranch(top: string, branch: string) {
  const current = (await runGit(top, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { okCodes: [1] })).trim();
  const local = await localName(top, branch);
  if (current === local) return;
  if ((await runGit(top, ['status', '--porcelain=v1'])).trim()) throw new Error(`Can't switch to ${local}: the project folder has uncommitted changes. Commit or stash them first.`);
  await assertFreeBranch(top, local);
  await runGit(top, ['switch', local]);
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
