import { Effect } from 'effect';
import type { AgentEvent } from '../../../../apps/desktop/src/host/types/agent.ts';
import { renameAutoBranch } from '../../../../apps/desktop/electron/git/branches.ts';
import type { Starts } from './starts.ts';

// How long past its worktree setup a new thread's agent waits for its title, so it starts on the named branch.
export const TITLE_WAIT_MS = 3_000;

/**
 * Names the thread and its temp branch `branch` in `dir` after `title`, waiting at most `waitMs` for it. No title in time, a
 * branch it couldn't rename, or your own name meanwhile (`keepTitle`) leaves both for the renderer, which names it after the
 * first exchange.
 */
export function nameThread(
  threadId: string,
  dir: string,
  branch: string,
  title: Promise<string | null>,
  start: ReturnType<Starts['begin']>,
  emit: (event: AgentEvent) => void,
  waitMs = TITLE_WAIT_MS,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const answer = yield* Effect.promise(() => title).pipe(
        Effect.timeoutOrElse({
          duration: waitMs,
          orElse: () => Effect.succeed(null),
        }),
      );
      if (!answer || start.signal.aborted || start.keepsTitle()) return;
      const named = yield* Effect.tryPromise(() =>
        renameAutoBranch(dir, branch, answer),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`Branch of ${threadId} not renamed`, cause).pipe(
            Effect.as(null),
          ),
        ),
      );
      if (!named) return;
      emit({ threadId, type: 'branch', branch: named });
      emit({ threadId, type: 'title', title: answer });
    }),
  );
}
