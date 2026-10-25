import { threadRoot } from '../git/root.ts';
import type { Repo, Thread } from '../model.ts';

/**
 * Where an agent's start runs: a thread's worktree, else its project folder. A window knows its worktree paths and sets
 * these as its modules load (`src/host/cwd.ts`); Core sets its own from what is on disk (packages/core/src/store/commands.ts).
 */
export interface StartEnv {
  threadCwd: (thread: Pick<Thread, 'id' | 'repo' | 'live'>) => string | null;
  projectRoot: (repo: Repo) => string | null;
  worktreePath: (
    thread: Pick<Thread, 'id' | 'repo' | 'live'>,
  ) => string | undefined;
}

let env: StartEnv = {
  threadCwd: threadRoot,
  projectRoot: (repo) => repo.path ?? null,
  worktreePath: () => undefined,
};

export const startEnv = () => env;

export function setStartEnv(set: Partial<StartEnv>) {
  env = { ...env, ...set };
}
