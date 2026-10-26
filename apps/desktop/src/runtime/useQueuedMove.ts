import { useEffect } from 'react';
import { useHarness } from '../store';

/** Moves each chat an agent asked to move (`move_to_project`) once its turn has ended. */
export function useQueuedMove() {
  const { state, dispatch } = useHarness();
  useEffect(() => {
    for (const thread of state.threads)
      if (!thread.repo && thread.live?.moveTo && !thread.live.isWorking)
        dispatch({
          type: 'attach-project',
          threadId: thread.id,
          project: thread.live.moveTo,
        });
  }, [state.threads, dispatch]);
}
