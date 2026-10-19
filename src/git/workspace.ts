import type { StartWorkspace } from '../host/types/agent.ts';
import type { Head } from '../host/types/git.ts';
import type { Repo, Thread } from '../model.ts';

export type WorkspaceMode = 'worktree' | 'folder';

/** The workspace part of a new thread's repo, as the pickers chose it; unset fields take the defaults (`create` in the store). */
export type WorkspaceDraft = Pick<Repo, 'base' | 'isExisting' | 'autoBranch'> & { mode: WorkspaceMode; branch?: string };

export const workspaceMode = (repo: Repo): WorkspaceMode => repo.mode ?? 'worktree';

/** How main sets up the thread's folder on a first start or a scheduled run. */
export function startWorkspace(repo: Repo | null): StartWorkspace | undefined {
  if (!repo) return;
  return { mode: workspaceMode(repo), branch: repo.branch, ...(repo.base && { base: repo.base }), ...(repo.isExisting && { isExisting: true }) };
}

/** The repo as its checkout really is: the branch it has (or a detached HEAD's commit), in its own worktree when `isWorktree`. */
export function withHead(repo: Repo, head: Head, isWorktree: boolean): Repo {
  const { mode, isDetached: _, ...rest } = repo;
  return { ...rest, branch: head.branch, ...(head.isDetached && { isDetached: true }), ...(!isWorktree && mode && { mode }) };
}

/** The branch, or "detached at <commit>": a commit is never passed off as a branch name. */
export function branchText(repo: Repo) {
  return repo.isDetached ? `detached at ${repo.branch}` : repo.branch;
}

/** The repo fields a draft sets: a folder thread never has a base, a checked-out branch never needs one. */
export function repoWorkspace(draft: WorkspaceDraft): Pick<Repo, 'mode' | 'base' | 'isExisting'> {
  if (draft.mode === 'folder') return { mode: 'folder', ...(draft.isExisting && { isExisting: true }) };
  return draft.isExisting ? { isExisting: true } : { ...(draft.base && { base: draft.base }) };
}

const MAX_SLUG_WORDS = 5;
const MAX_SLUG_CHARS = 40;

// The first word that says what kind of change it is; anything else is a feature. The Conventional Commits types.
const TYPE_CUES: [RegExp, string][] = [
  [/^(fix|fixes|fixed|bug|broken|crash|crashes|repair|resolve)$/, 'fix'],
  [/^(docs?|document|readme|changelog)$/, 'docs'],
  [/^(refactor|clean|cleanup|rename|move|extract|simplify|tidy)$/, 'refactor'],
  [/^(tests?|testing|cover|coverage)$/, 'test'],
  [/^(chore|bump|upgrade|deps|dependencies)$/, 'chore'],
  [/^(perf|speed|optimize|optimise)$/, 'perf'],
];
const FILLER = new Set(['the', 'a', 'an', 'please', 'can', 'you', 'could', 'we', 'lets', 'let', 'us', 'to', 'add', 'make', 'implement', 'create', 'build']);

/**
 * `prefix` + Conventional Commits type + the words that matter, dashed: "Fix the login bug!" → `fix/login-bug`,
 * "Add a dark mode toggle" → `feat/dark-mode-toggle`. Empty slug → `prefix` + `fallback`.
 */
export function branchName(prefix: string, text: string, fallback: string) {
  const words = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean);
  const cue = words.findIndex((w) => !FILLER.has(w));
  const type = TYPE_CUES.find(([re]) => re.test(words[cue] ?? ''))?.[1];
  const slug = words
    .filter((w, i) => !(type && i === cue) && !FILLER.has(w))
    .slice(0, MAX_SLUG_WORDS)
    .join('-')
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/, '');
  return slug ? `${prefix}${type ?? 'feat'}/${slug}` : `${prefix}${fallback}`;
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
