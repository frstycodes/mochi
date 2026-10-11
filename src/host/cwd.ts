import { worktreePath } from '../git/worktrees.ts';
import type { Thread } from '../model.ts';

/** The thread's own worktree once the worktree manager created it, else its project root. */
export function threadCwd(thread: Thread) {
  if (!thread.repo) return null;
  return worktreePath(thread.id) ?? projectRoot(thread.repo.project);
}

// GAP: threads carry a project name, not a folder; the project picker's "Open folder" doesn't keep paths yet. Until it does
// every project resolves to DEMO_ROOT, which the main process resolves against its own cwd (the harness repo in dev).
const PROJECT_ROOTS: Record<string, string> = {};
const DEMO_ROOT = '.';

export function projectRoot(project: string) {
  return PROJECT_ROOTS[project] ?? DEMO_ROOT;
}
