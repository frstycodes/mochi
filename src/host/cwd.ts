import { worktreePath } from '../git/worktrees.ts';
import type { Thread } from '../model.ts';
import { host } from './index.ts';
import { setStartEnv } from '../runtime/startEnv.ts';

// The web build's host mocks ignore the folder, so its fixture projects (no path) get a placeholder root.
const WEB_FIXTURE_ROOT = '.';

/**
 * The one answer to "where does this thread work": its worktree whenever it has one (whatever mode it was started in), else its
 * project folder. A folderless chat has the folder main made for it once started, else null; so has a project with no path on
 * desktop. The agent's start, tools and panes all use it.
 */
export function threadCwd(
  thread: Pick<Thread, 'id' | 'repo' | 'live'>,
  isDesktop = host.isDesktop,
) {
  if (!thread.repo) return thread.live?.cwd ?? null;
  return worktreePath(thread.id) ?? projectRoot(thread.repo, isDesktop);
}

export function projectRoot(
  repo: NonNullable<Thread['repo']>,
  isDesktop = host.isDesktop,
) {
  return repo.path ?? (isDesktop ? null : WEB_FIXTURE_ROOT);
}

setStartEnv({
  threadCwd: (thread) => threadCwd(thread),
  projectRoot: (repo) => projectRoot(repo),
  worktreePath: (thread) => worktreePath(thread.id),
});
