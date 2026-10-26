import { Effect } from 'effect';
import type { AgentEvent } from '../../../../apps/desktop/src/host/types/agent.ts';
import { moveWorktree, renameAutoBranch } from '../git/branches.ts';
import type { Starts } from './starts.ts';

// How long past its worktree setup a new thread's agent waits for its title, so it starts on the named branch.
export const TITLE_WAIT_MS = 3_000;

/**
 * Names the thread, its temp branch `branch` and its worktree `dir` after `title`, waiting at most `waitMs` for it; the folder
 * the agent then runs in. Only before the agent's first launch: a running agent's folder never moves. No title in time or your
 * own name meanwhile (`keepTitle`) leaves all three for the reactor's `autoTitles`, which names the thread and branch after the
 * first exchange and leaves the folder; a branch it couldn't rename keeps its temp name, and its folder, under the new title.
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
      if (!answer || start.signal.aborted || start.keepsTitle()) return dir;
      const named = yield* attempt(`Branch of ${threadId} not renamed`, () =>
        renameAutoBranch(dir, branch, answer),
      );
      const moved =
        named &&
        (yield* attempt(`Worktree of ${threadId} not moved`, () =>
          // The temp branch is `<prefix><8 hex>`, so the folder takes the named branch's slug.
          moveWorktree(dir, named.slice(branch.length - 8)),
        ));
      if (named) emit({ threadId, type: 'branch', branch: named });
      if (moved) emit({ threadId, type: 'worktree', path: moved });
      emit({ threadId, type: 'title', title: answer });
      return moved ?? dir;
    }),
  );
}

const attempt = <T>(failed: string, run: () => Promise<T>) =>
  Effect.tryPromise(run).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(failed, cause).pipe(Effect.as(null)),
    ),
  );
