import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit } from './run.ts';

export function checkpointRef(threadId: string, n: number | 'undo') {
  if (!/^[\w-]{1,64}$/.test(threadId)) throw new Error('threadId must be letters, digits, - or _');
  if (n !== 'undo' && (!Number.isInteger(n) || n < 0 || n > 1_000_000)) throw new TypeError('checkpoint must be a non-negative integer or "undo"');
  return `refs/harness/checkpoints/${threadId}/${n}`;
}

/** A commit of the work tree's files (untracked included, ignored not) whose parent is HEAD, stored at `ref`. HEAD, index and files stay as they are. */
export async function snapshot(top: string, ref: string, message: string) {
  // A throwaway index, so the user's staged state is never touched.
  const index = join(tmpdir(), `harness-index-${randomUUID()}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    const head = (await runGit(top, ['rev-parse', '--verify', 'HEAD'])).trim();
    await runGit(top, ['read-tree', head], { env });
    await runGit(top, ['add', '-A', '--', '.'], { env });
    const tree = (await runGit(top, ['write-tree'], { env })).trim();
    const commit = (await runGit(top, ['commit-tree', tree, '-p', head, '-m', message])).trim();
    await runGit(top, ['update-ref', ref, commit]);
    return commit;
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

export async function resolveCommit(top: string, ref: string) {
  return (await runGit(top, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim();
}
