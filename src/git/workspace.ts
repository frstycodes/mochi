import type { StartWorkspace } from '../host/types/agent.ts';
import type { Head } from '../host/types/git.ts';
import type { Repo, Thread } from '../model.ts';

export type WorkspaceMode = 'worktree' | 'folder';

/** The workspace part of a new thread's repo, as the pickers chose it; unset fields take the defaults (`create` in the store). */
export type WorkspaceDraft = Pick<
  Repo,
  'base' | 'isExisting' | 'autoBranch'
> & { mode: WorkspaceMode; branch?: string };

export const workspaceMode = (repo: Repo): WorkspaceMode =>
  repo.mode ?? 'worktree';

/** How main sets up the thread's folder on a first start or a scheduled run. */
export function startWorkspace(repo: Repo | null): StartWorkspace | undefined {
  if (!repo) return;
  return {
    mode: workspaceMode(repo),
    branch: repo.branch,
    ...(repo.base && { base: repo.base }),
    ...(repo.isExisting && { isExisting: true }),
  };
}

/** The repo as its checkout really is: the branch it has (or a detached HEAD's commit), in its own worktree when `isWorktree`. */
export function withHead(repo: Repo, head: Head, isWorktree: boolean): Repo {
  const { mode, isDetached: _, ...rest } = repo;
  return {
    ...rest,
    branch: head.branch,
    ...(head.isDetached && { isDetached: true }),
    ...(!isWorktree && mode && { mode }),
  };
}

/** The branch, or "detached at <commit>": a commit is never passed off as a branch name. */
export function branchText(repo: Repo) {
  return repo.isDetached ? `detached at ${repo.branch}` : repo.branch;
}

/** The repo fields a draft sets: a folder thread never has a base, a checked-out branch never needs one. */
export function repoWorkspace(
  draft: WorkspaceDraft,
): Pick<Repo, 'mode' | 'base' | 'isExisting'> {
  if (draft.mode === 'folder')
    return { mode: 'folder', ...(draft.isExisting && { isExisting: true }) };
  return draft.isExisting
    ? { isExisting: true }
    : { ...(draft.base && { base: draft.base }) };
}

const MAX_SLUG_CHARS = 40;
const TEMP_HEX = /^[0-9a-f]{8}$/;

/** `prefix` + 8 hex from `seed`, the name a new thread's branch has until its title names it. Pure, so the reducer can make it. */
export function tempBranch(prefix: string, seed: string) {
  // FNV-1a over a seed unique to the thread: a clash is 1 in 4 billion, and createWorktree refuses one.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++)
    hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193);
  return `${prefix}${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * The branch a thread on the temp name `temp` takes once `title` names it: the same prefix + the title as a slug, made unique
 * against `taken` ("Fix login bug" → `mochi/fix-login-bug`, then `mochi/fix-login-bug-2`). Null when `temp` isn't a temp name
 * or the title has no letters to slug.
 */
export function branchFromTitle(
  temp: string,
  title: string,
  taken: ReadonlySet<string>,
) {
  const prefix = temp.slice(0, -8);
  if (!TEMP_HEX.test(temp.slice(-8))) return null;
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .join('-')
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/, '');
  if (!slug) return null;
  const name = `${prefix}${slug}`;
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name}-${n}`)) n++;
  return `${name}-${n}`;
}

/** A thread whose folder isn't set up yet (a scheduled thread before its first run): its workspace can still change. */
export function isUnstarted(thread: Thread) {
  return !!thread.repo && !!thread.live?.isDetached && !thread.session;
}
