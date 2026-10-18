import { useEffect, type Dispatch } from 'react';
import { host } from '../host';
import type { Thread } from '../model';
import type { Action } from '../store';
import { parseTitle } from './prompts';
import { automaticBranchTitle, titleRequest } from './titles';
import { worktreePath } from '../git/worktrees';

// Once per thread per launch: a thread no model could name keeps its truncated first message.
const asked = new Set<string>();

/** Names each live thread after its first exchange, on the Settings › Models › Background tasks model. */
export function useAutoTitles(threads: Thread[], dispatch: Dispatch<Action>) {
  useEffect(() => {
    if (!host.isDesktop) return;
    for (const t of threads) {
      const prompt = !asked.has(t.id) && titleRequest(t);
      if (!prompt) continue;
      asked.add(t.id);
      void host.agent.utility('title', t.spaceId, prompt).then(
        async (text) => {
          const title = text && parseTitle(text);
          if (!title) return;
          dispatch({ type: 'title-generated', threadId: t.id, title });
          const name = automaticBranchTitle(t, title);
          const cwd = worktreePath(t.id);
          if (!name || !cwd) return;
          try {
            const branch = await host.git.renameAutoBranch(cwd, t.repo!.branch, name);
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
