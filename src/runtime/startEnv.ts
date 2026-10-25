import { threadRoot } from '../git/root.ts';
import type { AgentStartOptions } from '../host/types/agent.ts';
import type { Provider, Repo, Thread } from '../model.ts';
import type { ThreadControls } from './controls.ts';

/**
 * What only a window holds that an agent's start reads: this window's worktree paths and its profiles' options. The renderer
 * sets them as its modules load (`src/host/cwd.ts`, `src/runtime/startOptions.ts`). Core sets none: a command whose agent
 * call is a start goes to a window (packages/core/src/store/commands.ts).
 */
export interface StartEnv {
  threadCwd: (thread: Pick<Thread, 'id' | 'repo' | 'live'>) => string | null;
  projectRoot: (repo: Repo) => string | null;
  worktreePath: (threadId: string) => string | undefined;
  agentOptions: (
    controls: ThreadControls,
    provider: Provider,
    spaceId: string,
  ) => Partial<AgentStartOptions>;
}

let env: StartEnv = {
  threadCwd: threadRoot,
  projectRoot: (repo) => repo.path ?? null,
  worktreePath: () => undefined,
  agentOptions: () => ({}),
};

export const startEnv = () => env;

export function setStartEnv(set: Partial<StartEnv>) {
  env = { ...env, ...set };
}
