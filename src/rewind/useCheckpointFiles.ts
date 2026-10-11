import { useEffect, useRef } from 'react';
import { host } from '../host/index.ts';
import { useHarness } from '../store/index.tsx';
import { useWorktreePaths } from '../git/worktrees.ts';

// GAP: the tick simulation finishes steps in the reducer, so files are saved a moment after the boundary. The agent runtime
// should checkpoint itself between tool calls instead.
/** Saves the worktree's files for every checkpoint that asks for them, once the thread has a worktree of its own. */
export function useCheckpointFiles() {
  const { state, dispatch } = useHarness();
  const paths = useWorktreePaths();
  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    for (const [threadId, list] of Object.entries(state.checkpoints)) {
      const cwd = paths[threadId];
      if (!cwd) continue;
      for (const c of list) {
        const key = `${threadId}/${c.n}`;
        if (!c.wantsFiles || inFlight.current.has(key)) continue;
        inFlight.current.add(key);
        host.git.checkpoint(cwd, threadId, c.n).then(
          (ref) => dispatch({ type: 'checkpoint-ref', threadId, n: c.n, ref }),
          () => dispatch({ type: 'checkpoint-ref', threadId, n: c.n, ref: null }),
        );
      }
    }
  }, [state.checkpoints, paths, dispatch]);
}
