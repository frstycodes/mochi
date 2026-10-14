import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit } from './run.ts';

/** `undo`: the files a rewind replaced. `turn`: the files as the agent's last turn left them, to tell its changes from anyone else's. */
export function checkpointRef(threadId: string, n: number | 'undo' | 'turn') {
  if (!/^[\w-]{1,64}$/.test(threadId)) throw new Error('threadId must be letters, digits, - or _');
  if (n !== 'undo' && n !== 'turn' && (!Number.isInteger(n) || n < 0 || n > 1_000_000)) throw new TypeError('checkpoint must be a non-negative integer, "undo" or "turn"');
  return `refs/harness/checkpoints/${threadId}/${n}`;
}

/** A commit of the work tree's files (untracked included, ignored not) whose parent is HEAD, stored at `ref`. HEAD, index and files stay as they are. */
export async function snapshot(top: string, ref: string, message: string) {
  const commit = await snapshotCommit(top, message);
  await runGit(top, ['update-ref', ref, commit]);
  return commit;
}

/** `snapshot` without a ref: the work tree's files as an unreferenced commit, for comparing. */
export async function snapshotCommit(top: string, message: string) {
  // A throwaway index, so the user's staged state is never touched.
  const index = join(tmpdir(), `harness-index-${randomUUID()}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    const head = (await runGit(top, ['rev-parse', '--verify', 'HEAD'])).trim();
    await runGit(top, ['read-tree', head], { env });
    await runGit(top, ['add', '-A', '--', '.'], { env });
    const tree = (await runGit(top, ['write-tree'], { env })).trim();
    return (await runGit(top, ['commit-tree', tree, '-p', head, '-m', message])).trim();
  } finally {
    await rm(index, { force: true });
  }
}

/** Moves the current branch to the checkpoint's parent and the files to the checkpoint, leaving its changes uncommitted as they were. */
export async function restore(top: string, commit: string) {
  await runGit(top, ['reset', '--hard', '--quiet', `${commit}^`]);
  // -d without -x: untracked files go, ignored ones (node_modules, .env) stay.
  await runGit(top, ['clean', '-fd', '--quiet']);
  await applyFiles(top, commit);
}

/** Writes the commit's files over the work tree, then unstages them so they read as uncommitted changes. */
export async function applyFiles(top: string, commit: string) {
  await runGit(top, ['checkout', commit, '--', '.']);
  await runGit(top, ['reset', '--quiet']);
}

/**
 * Puts only `paths` back to how the commit held them: files it had are checked out (and left unstaged), files it didn't have
 * are deleted. Every other file stays as it is. `paths` are relative to `top`.
 */
export async function restorePaths(top: string, commit: string, paths: string[]) {
  // Agents name files, not patterns: a path like `app/[id].tsx` must not match as a glob.
  const held = new Set((await runGit(top, ['--literal-pathspecs', 'ls-tree', '-r', '-z', '--name-only', commit, '--', ...paths])).split('\0').filter(Boolean));
  const back = paths.filter((p) => held.has(p));
  if (back.length) {
    await runGit(top, ['--literal-pathspecs', 'checkout', commit, '--', ...back]);
    await runGit(top, ['--literal-pathspecs', 'reset', '--quiet', '--', ...back]);
  }
  await Promise.all(paths.filter((p) => !held.has(p)).map((p) => rm(join(top, p), { force: true })));
}

export async function resolveCommit(top: string, ref: string) {
  // --quiet exits 1 for a missing ref: that's an answer (''), not a failure.
  return (await runGit(top, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { okCodes: [1] })).trim();
}

/** Paths whose content differs between two commits' trees. */
export async function changedPaths(top: string, from: string, to: string) {
  return (await runGit(top, ['diff', '--name-only', '-z', from, to])).split('\0').filter(Boolean);
}
