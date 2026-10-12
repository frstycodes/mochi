import { worktreePath } from '../git/worktrees.ts';
import type { Thread } from '../model.ts';
import { host } from './index.ts';

// The web build's host mocks ignore the folder, so its fixture projects (no path) get a placeholder root.
const WEB_FIXTURE_ROOT = '.';

/** The thread's own worktree once it was made, else its project folder (always, for a project folder thread); null for a folderless chat or a project with no path on desktop. */
export function threadCwd(thread: Thread, isDesktop = host.isDesktop) {
  if (!thread.repo) return null;
  if (thread.repo.mode === 'folder') return projectRoot(thread.repo, isDesktop);
  return worktreePath(thread.id) ?? projectRoot(thread.repo, isDesktop);
}

export function projectRoot(repo: NonNullable<Thread['repo']>, isDesktop = host.isDesktop) {
  return repo.path ?? (isDesktop ? null : WEB_FIXTURE_ROOT);
}
