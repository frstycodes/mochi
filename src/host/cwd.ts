import type { Thread } from '../model.ts';

// GAP: threads only carry a project name; real folders come from the worktree manager (session `git`). Until then every
// fixture project resolves to DEMO_ROOT, which the main process resolves against its own cwd (the harness repo in dev).
const PROJECT_ROOTS: Record<string, string> = {};
const DEMO_ROOT = '.';

export function threadCwd(thread: Thread) {
  if (!thread.repo) return null;
  return PROJECT_ROOTS[thread.repo.project] ?? DEMO_ROOT;
}
