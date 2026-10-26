import { Effect } from 'effect';
import type {
  AgentRunOptions,
  AgentStartOptions,
} from '../../../../apps/desktop/src/host/types/agent.ts';
import type { HarnessAdapter } from '../agents/adapter.ts';
import { emitAgentEvent } from '../agents/events.ts';
import type { ThreadContext } from './context.ts';

/**
 * Starts the thread's session on `adapter` with what Core keeps for it: after a switch, the provider's earlier session to resume,
 * or the handoff written now, for its instructions; recorded on the thread as a `context` event.
 */
export async function launchSession(
  context: ThreadContext['Service'],
  adapter: HarnessAdapter,
  threadId: string,
  run: AgentRunOptions,
  switchFrom: AgentStartOptions['switchFrom'],
  signal?: AbortSignal,
) {
  return adapter.start(
    threadId,
    await preparedRun(context, threadId, run, switchFrom),
    signal,
  );
}

/** `run` with what `context.prepare` gives the start: the session to resume and the package for its instructions. */
export async function preparedRun(
  context: ThreadContext['Service'],
  threadId: string,
  run: AgentRunOptions,
  switchFrom: AgentStartOptions['switchFrom'],
): Promise<AgentRunOptions> {
  const prepared = await Effect.runPromise(
    context.prepare({
      threadId,
      spaceId: run.spaceId,
      provider: run.provider,
      ...(run.model && { model: run.model }),
      cwd: run.cwd,
      prompt: run.prompt,
      ...(switchFrom && { switchFrom }),
      onWriting: () => emitAgentEvent({ threadId, type: 'context-writing' }),
    }),
  );
  if (prepared.delivered)
    emitAgentEvent({ threadId, type: 'context', ...prepared.delivered });
  return {
    ...run,
    ...(prepared.resume && { resume: prepared.resume }),
    ...(prepared.context && { context: prepared.context }),
  };
}
