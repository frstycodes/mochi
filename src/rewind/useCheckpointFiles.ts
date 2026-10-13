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
  const wasWorking = useRef(new Map<string, boolean>());
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

  // The files as each finished turn left them: a files rewind compares against these to find changes made outside the agent.
  useEffect(() => {
    for (const t of state.threads) {
      const isWorking = !!t.live?.isWorking;
      const was = wasWorking.current.get(t.id);
      wasWorking.current.set(t.id, isWorking);
      const cwd = paths[t.id];
      if (was && !isWorking && cwd) host.git.checkpoint(cwd, t.id, 'turn').catch((error) => console.warn('Could not save the turn checkpoint', error));
    }
  }, [state.threads, paths]);
}
