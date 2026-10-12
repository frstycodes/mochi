import type { StartWorkspace } from '../host/types/agent.ts';
import type { Repo, Thread } from '../model.ts';

export type WorkspaceMode = 'worktree' | 'folder';

/** The workspace part of a new thread's repo, as the pickers chose it; unset fields take the defaults (`create` in the store). */
export type WorkspaceDraft = Pick<Repo, 'base' | 'isExisting'> & { mode: WorkspaceMode; branch?: string };

export const workspaceMode = (repo: Repo): WorkspaceMode => repo.mode ?? 'worktree';

/** How main sets up the thread's folder on a first start or a scheduled run. */
export function startWorkspace(repo: Repo | null): StartWorkspace | undefined {
  if (!repo) return;
  return { mode: workspaceMode(repo), branch: repo.branch, ...(repo.base && { base: repo.base }), ...(repo.isExisting && { isExisting: true }) };
}

/** The repo fields a draft sets: a folder thread never has a base, a checked-out branch never needs one. */
export function repoWorkspace(draft: WorkspaceDraft): Pick<Repo, 'mode' | 'base' | 'isExisting'> {
  if (draft.mode === 'folder') return { mode: 'folder', ...(draft.isExisting && { isExisting: true }) };
  return draft.isExisting ? { isExisting: true } : { ...(draft.base && { base: draft.base }) };
}

const MAX_SLUG_WORDS = 5;
const MAX_SLUG_CHARS = 40;

/** `prefix` + the first words of `text`, lowercased and dashed: "Fix the login bug!" → `mochi/fix-the-login-bug`. Empty slug → `fallback`. */
export function branchName(prefix: string, text: string, fallback: string) {
  const slug = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, MAX_SLUG_WORDS)
    .join('-')
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/, '');
  return `${prefix}${slug || fallback}`;
}

/** `name`, or `name-2`, `name-3`… when taken. */
export function uniqueBranch(name: string, taken: ReadonlySet<string>) {
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name}-${n}`)) n++;
  return `${name}-${n}`;
}

/** A thread whose folder isn't set up yet (a scheduled thread before its first run): its workspace can still change. */
export function isUnstarted(thread: Thread) {
  return !!thread.repo && !!thread.live?.isDetached && !thread.session;
}
