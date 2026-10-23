import { useEffect, useRef, type Dispatch } from 'react';
import { host } from '../host';
import type { Thread } from '../model';
import type { Action } from '../store';
import { parseTitle } from './prompts';
import { runUtility } from './runUtility';
import { hasTempBranch, titleRequest } from './titles';
import { worktreePath } from '../git/worktrees';

// Once per thread per launch: a thread no model could name keeps its truncated first message.
const asked = new Set<string>();

/**
 * Names each live thread main couldn't name before its start (`startTitleRequest`) after its first exchange, on the
 * Settings › Models › Background tasks model; its branch too while that's still the temp name.
 */
export function useAutoTitles(threads: Thread[], dispatch: Dispatch<Action>) {
  const latest = useRef(threads);
  useEffect(() => {
    latest.current = threads;
    if (!host.isDesktop) return;
    for (const t of threads) {
      const prompt = !asked.has(t.id) && titleRequest(t);
      if (!prompt) continue;
      asked.add(t.id);
      void runUtility('title', t.spaceId, prompt, t.id).then(
        async (text) => {
          const title = text && parseTitle(text);
          // A rename while the call was out wins, title and branch both.
          const now = latest.current.find((x) => x.id === t.id);
          if (!title || !now || now.isTitleRenamed) return;
          dispatch({ type: 'title-generated', threadId: t.id, title });
          const cwd = worktreePath(t.id);
          if (!hasTempBranch(now) || !cwd) return;
          try {
            const branch = await host.git.renameAutoBranch(cwd, now.repo!.branch, title);
            if (branch) dispatch({ type: 'repo-head', threadId: t.id, head: { branch, isDetached: false }, worktree: cwd });
          } catch (error) {
            console.warn('Automatic branch not renamed', error);
          }
        },
        (error: unknown) => console.warn('Thread title not generated', error),
      );
    }
  }, [threads, dispatch]);
}
