import type { AgentEvent } from '../../src/host/types/agent.ts';
import { renameAutoBranch } from '../git/branches.ts';
import type { Starts } from './starts.ts';

// How long past its worktree setup a new thread's agent waits for its title, so it starts on the named branch.
export const TITLE_WAIT_MS = 3_000;

/**
 * Names the thread and its temp branch `branch` in `dir` after `title`, waiting at most `waitMs` for it. No title in time, a
 * branch it couldn't rename, or your own name meanwhile (`keepTitle`) leaves both for the renderer, which names it after the
 * first exchange.
 */
export async function nameThread(threadId: string, dir: string, branch: string, title: Promise<string | null>, start: ReturnType<Starts['begin']>, emit: (event: AgentEvent) => void, waitMs = TITLE_WAIT_MS) {
  const answer = await Promise.race([title, new Promise<null>((resolve) => setTimeout(resolve, waitMs, null))]);
  if (!answer || start.signal.aborted || start.keepsTitle()) return;
  const named = await renameAutoBranch(dir, branch, answer).catch((error: unknown) => {
    console.warn(`Branch of ${threadId} not renamed`, error);
    return null;
  });
  if (!named) return;
  emit({ threadId, type: 'branch', branch: named });
  emit({ threadId, type: 'title', title: answer });
}
