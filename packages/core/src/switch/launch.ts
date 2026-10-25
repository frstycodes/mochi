import { Effect } from 'effect';
import type {
  AgentRunOptions,
  AgentStartOptions,
} from '../../../../apps/desktop/src/host/types/agent.ts';
import type { HarnessAdapter } from '../agents/adapter.ts';
import { emitAgentEvent } from '../agents/events.ts';
import type { ThreadContext } from './context.ts';

/**
 * Starts the thread's session on `adapter` with what Core keeps for it: after a switch, the provider's earlier session to resume
 * and the thread so far for its instructions, recorded on the thread as a `context` event.
 */
export async function launchSession(
  context: ThreadContext['Service'],
  adapter: HarnessAdapter,
  threadId: string,
  run: AgentRunOptions,
  switchFrom: AgentStartOptions['switchFrom'],
  signal?: AbortSignal,
) {
  const prepared = await Effect.runPromise(
    context.prepare(threadId, run.provider, run.model, run.cwd, switchFrom),
  );
  if (prepared.delivered)
    emitAgentEvent({ threadId, type: 'context', ...prepared.delivered });
  return adapter.start(
    threadId,
    {
      ...run,
      ...(prepared.resume && { resume: prepared.resume }),
      ...(prepared.context && { context: prepared.context }),
    },
    signal,
  );
}
