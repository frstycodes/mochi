import { worktreePath } from '../git/worktrees.ts';
import type { Thread } from '../model.ts';
import { host } from './index.ts';
import { setStartEnv } from '../runtime/startEnv.ts';
import { parseRemoteThreadId } from '../remote/ids.ts';

// The web build's host mocks ignore the folder, so its fixture projects (no path) get a placeholder root.
const WEB_FIXTURE_ROOT = '.';

/**
 * The one answer to "where does this thread work": its worktree whenever it has one (whatever mode it was started in), else its
 * project folder. A folderless chat has the folder main made for it once started, else null; so has a project with no path on
 * desktop. The agent's start, tools and panes all use it.
 *
 * Another computer's thread (a machine-aware id, `remote/ids.ts`) has none here: its path is that computer's, and git, files or
 * a terminal run on a same-named folder of this one would act on the wrong work. Its panes read through commands instead.
 */
const reported = new Set<string>();

export function threadCwd(
  thread: Pick<Thread, 'id' | 'repo' | 'live'>,
  isDesktop = host.isDesktop,
) {
  if (parseRemoteThreadId(thread.id)) {
    if (
      import.meta.env.DEV &&
      !reported.has(thread.id) &&
      reported.add(thread.id)
    )
      console.error(
        `threadCwd asked for another computer's thread ${thread.id}; gate the caller on its origin`,
      );
    return null;
  }
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
