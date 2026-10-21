import { existsSync } from 'node:fs';
import type { MoveChanges, StartWorkspace } from '../../src/host/types/agent.ts';
import { addBranchWorktree, switchBranch } from './branches.ts';
import { mainRepo, runGit, topLevel } from './run.ts';

interface Stash {
  sha: string;
  name: string;
}

/**
 * Sets up where a moved thread works: `root` itself, its own worktree there (`worktreeDir`), or `root`'s checkout switched to the
 * workspace's branch. The uncommitted changes in `from` come along (`bring`, only within one repository and into a clean checkout)
 * or stay stashed in `from`'s repository (`stash`); a failed move puts them back in `from`. Nothing is ever discarded.
 */
export async function moveCheckout(threadId: string, from: string | null, root: string, workspace: StartWorkspace | undefined, changes: MoveChanges, worktreeDir: (repo: string) => string) {
  const source = from === null ? null : await topLevel(from).catch(() => null);
  const target = await topLevel(root).catch(() => null);
  if (workspace && !target) throw new Error(`${root} isn't a git repository, so it has no branches or worktrees`);
  const dest = workspace && target ? (workspace.mode === 'folder' ? target : worktreeDir(await mainRepo(target))) : null;
  const isDirty = !!source && (await hasChanges(source));
  if (source && dest === source) return switchInPlace(threadId, from!, source, workspace!, isDirty ? changes : 'bring');
  if (isDirty && changes === 'bring') await assertCanBring(source!, target, dest);
  const stash = isDirty ? await stashChanges(source!, threadId) : undefined;
  try {
    const placed = dest && workspace ? await place(target!, dest, workspace) : { cwd: root, isNew: false };
    // The project folder is the cwd the thread had before: `root`, not git's resolved top level.
    const cwd = workspace?.mode === 'folder' ? root : placed.cwd;
    if (stash && changes === 'bring') await bring(cwd, stash);
    if (stash && changes === 'bring') await dropStash(source!, stash);
    return { cwd, isNew: placed.isNew, ...(stash && changes === 'stash' && { stash: stash.name }) };
  } catch (error) {
    if (stash) await unstash(source!, stash);
    throw error;
  }
}

/** The thread's own checkout switches branch: `bring` is git's own carry-over, refused on conflict; `stash` saves them first. */
async function switchInPlace(threadId: string, cwd: string, top: string, workspace: StartWorkspace, changes: MoveChanges) {
  const stash = changes === 'stash' ? await stashChanges(top, threadId) : undefined;
  try {
    await checkout(top, workspace, 'bring');
  } catch (error) {
    if (stash) await unstash(top, stash);
    throw error;
  }
  return { cwd, isNew: false, ...(stash && { stash: stash.name }) };
}

async function assertCanBring(source: string, target: string | null, dest: string | null) {
  if (!target || !dest || (await mainRepo(source)) !== (await mainRepo(target))) throw new Error(`${source} has uncommitted changes, and they can only come along within the same repository. Commit them, or stash them instead.`);
  if (existsSync(dest) && (await hasChanges(dest))) throw new Error(`${dest} has uncommitted changes of its own. Commit or stash them there first, or stash yours instead.`);
}

/** A new worktree at `dest`, or the existing checkout there switched to the workspace's branch. */
async function place(top: string, dest: string, workspace: StartWorkspace) {
  if (workspace.mode === 'worktree' && !existsSync(dest)) {
    await addBranchWorktree(top, dest, workspace.branch, { base: workspace.base, isExisting: workspace.isExisting, isNew: !workspace.isExisting });
    return { cwd: dest, isNew: true };
  }
  await checkout(dest, workspace, 'refuse');
  return { cwd: dest, isNew: false };
}

/** A project folder stays on its branch unless one was picked (`isExisting`); a worktree's new branch starts from `base`, else HEAD. */
async function checkout(top: string, { mode, branch, base, isExisting }: StartWorkspace, changes: 'bring' | 'refuse') {
  if (mode === 'folder' && !isExisting) return;
  if (!isExisting) await runGit(top, ['branch', branch, base ?? 'HEAD']);
  await switchBranch(top, branch, { changes });
}

/** Applies the stash in the clean checkout `cwd`; on a conflict, `cwd` goes back to clean and the stash stays for `unstash`. */
async function bring(cwd: string, stash: Stash) {
  try {
    await runGit(cwd, ['stash', 'apply', '--index', stash.sha]).catch(() => runGit(cwd, ['stash', 'apply', stash.sha]));
  } catch (error) {
    await runGit(cwd, ['reset', '--hard', '-q']);
    await runGit(cwd, ['clean', '-fdq']);
    throw new Error(`The uncommitted changes don't apply on the new branch, so nothing moved: ${(error as Error).message}`, { cause: error });
  }
}

async function hasChanges(top: string) {
  return (await runGit(top, ['status', '--porcelain=v1'])).trim() !== '';
}

// The stash list is shared with every worktree and session of the repository: entries are found by their sha, never by position.
async function stashChanges(top: string, threadId: string): Promise<Stash> {
  const name = `mochi: ${threadId} before moving, ${new Date().toISOString()}`;
  await runGit(top, ['stash', 'push', '--include-untracked', '-m', name]);
  const rows = (await runGit(top, ['stash', 'list', '--format=%H%x00%gs'])).split('\n').map((line) => line.split('\0'));
  const sha = rows.find(([, subject]) => subject?.endsWith(name))?.[0];
  if (!sha) throw new Error(`Stashed the changes in ${top} as "${name}", but couldn't find the stash again`);
  return { sha, name };
}

async function unstash(top: string, stash: Stash) {
  await runGit(top, ['stash', 'apply', '--index', stash.sha]);
  await dropStash(top, stash);
}

async function dropStash(top: string, stash: Stash) {
  const at = (await runGit(top, ['stash', 'list', '--format=%H'])).split('\n').indexOf(stash.sha);
  if (at >= 0) await runGit(top, ['stash', 'drop', '-q', `stash@{${at}}`]);
}
