import type { GitHost, Head } from '../host/types/git.ts';
import type { Thread } from '../model.ts';

export interface RecoveredCheckout {
  threadId: string;
  head: Head;
  /** Set when the thread's own worktree was found on disk: it becomes the thread's folder. */
  worktree?: string;
}

/**
 * Each started project thread's checkout as it is on disk. A Mochi worktree named after the thread (`<root>/<repo>/<threadId>`,
 * from `worktrees`) is its folder whatever mode it was started in; then its branch, or detached commit, is read. A project folder
 * thread reads the checkout only while unsettled: a settled one keeps the branch it worked on. A worktree thread whose worktree
 * is gone (cleanup) keeps its branch too, since the project folder's HEAD isn't its.
 */
export async function recoverCheckouts(
  threads: Thread[],
  known: (threadId: string) => string | undefined,
  git: Pick<GitHost, 'worktrees' | 'head'>,
): Promise<RecoveredCheckout[]> {
  const started = threads.filter((t) => !!t.repo?.path && !!t.session);
  const onDisk = new Map<string, string>();
  for (const root of new Set(started.map((t) => t.repo!.path!))) {
    for (const w of await git.worktrees(root).catch(() => []))
      onDisk.set(`${root}\0${w.path.split(/[\\/]/).at(-1)}`, w.path);
  }
  const found = await Promise.all(
    started.map(async (t): Promise<RecoveredCheckout | null> => {
      const worktree = known(t.id) ?? onDisk.get(`${t.repo!.path}\0${t.id}`);
      const isFolder = t.repo!.mode === 'folder';
      if (!worktree && (!isFolder || t.status === 'settled')) return null;
      const head = await git.head(worktree ?? t.repo!.path!).catch(() => null);
      if (!head) return null;
      const isSame =
        head.branch === t.repo!.branch &&
        head.isDetached === !!t.repo!.isDetached &&
        (!worktree ||
          (!isFolder &&
            (t.live?.cwd ?? worktree) === worktree &&
            known(t.id) === worktree));
      return isSame
        ? null
        : { threadId: t.id, head, ...(worktree && { worktree }) };
    }),
  );
  return found.filter((r) => r !== null);
}
