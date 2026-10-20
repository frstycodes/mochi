import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

// GAP: the renderer names the root. Until the worktree manager (session `git`) registers thread roots in main, any
// directory the renderer asks for is accepted as a root; containment only stops escapes *from* that root.
export async function resolveRoot(root: string) {
  if (root.includes('\0')) throw new Error('root contains a NUL byte');
  // `~` roots: the viewer opens a file mentioned from outside the worktree (`@~/notes.md`) by its folder.
  const real = await realpath(path.resolve(root.replace(/^~(?=\/|$)/, homedir())));
  if (!(await stat(real)).isDirectory()) throw new Error(`${root} is not a directory`);
  return real;
}

/** Real path of an existing file under `root`. Checked before and after following symlinks, so neither `..` nor a link can escape. */
export async function resolveInside(root: string, rel: string) {
  if (rel.includes('\0')) throw new Error('path contains a NUL byte');
  if (path.isAbsolute(rel)) throw new Error('path must be relative to the root');
  const realRoot = await resolveRoot(root);
  const target = path.resolve(realRoot, rel);
  assertInside(realRoot, target, rel);
  const real = await realpath(target);
  assertInside(realRoot, real, rel);
  return real;
}

export function isInside(root: string, target: string) {
  const rel = path.relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function assertInside(root: string, target: string, rel: string) {
  if (!isInside(root, target)) throw new Error(`${rel} is outside the thread root`);
}
