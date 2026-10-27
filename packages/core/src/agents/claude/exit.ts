import type { AgentEvent } from '../../../../../apps/desktop/src/host/types/agent.ts';

/**
 * Claude Code's stream threw (the process died, often a stray `pkill` from some shell: exit 143). A turn in flight fails with it.
 * Between turns there is no turn to fail: the last one already ended, and the next send relaunches on the saved session, as after an eviction.
 */
export function exitEvent(
  threadId: string,
  isBusy: boolean,
  error: unknown,
): AgentEvent | null {
  if (!isBusy) return null;
  return {
    threadId,
    type: 'turn-end',
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  };
}
