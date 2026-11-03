import { host } from '../host/index.ts';
import { NO_AGENT_PROCESS } from '../host/types/agent.ts';
import { resolution, undelivered } from '../runtime/apply.ts';
import {
  agentCallArgs,
  agentCalls,
  resumeAfterLostProcess,
  unsentTurns,
  type AgentCall,
} from '../runtime/live.ts';
import type { Replica } from './replica.ts';
import { reducer } from './root.ts';
import type { Action, State } from './types.ts';

/**
 * The web build's Core: with no Core to send it to, the page acts on its own command the way `Commands.apply` does in
 * packages/core/src/store/commands.ts (its mock agents, no schedules or OS notifications). Keep the two in step.
 */
export function pageCommand(
  replica: Replica,
  before: State,
  action: Action,
  apply: (action: Action) => void,
) {
  const answer = resolution(before, action);
  if (answer)
    host.agent
      .resolve(answer.requestId, answer.decision)
      .catch((error: unknown) =>
        apply({
          type: 'say',
          threadId: answer.threadId,
          entry: undelivered(answer, error),
        }),
      );
  const next = reducer(before, action);
  const calls = agentCalls(before, action, () => next);
  replica.dispatch(action, next);
  for (const call of calls) {
    if (call.method === 'start') starting(replica, call);
    callAgent(replica, call).catch((error: unknown) => {
      const thread =
        call.method === 'send' && isLostProcess(error)
          ? replica.getState().threads.find((t) => t.id === call.threadId)
          : undefined;
      const retry =
        thread && call.method === 'send'
          ? resumeAfterLostProcess(thread, call)
          : [];
      if (retry.length === 0) return apply(failed(call.threadId, error));
      for (const again of retry) {
        if (again.method === 'start') starting(replica, again);
        callAgent(replica, again).catch((e: unknown) =>
          apply(failed(again.threadId, e)),
        );
      }
    });
  }
  for (const threadId of unsentTurns(before, next, calls))
    apply(failed(threadId, new Error('Mochi had no agent to send this to')));
}

function starting(
  replica: Replica,
  call: Extract<AgentCall, { method: 'start' }>,
) {
  replica.dispatch({
    type: 'agent-starting',
    threadId: call.threadId,
    provider: call.options.provider,
  });
}

// Sequential: a handoff's stop must reach the old agent before the new one starts in the same thread.
let pending: Promise<unknown> = Promise.resolve();

function callAgent(replica: Replica, call: AgentCall) {
  const run = () =>
    (
      host.agent[call.method] as (
        threadId: string,
        ...args: unknown[]
      ) => Promise<unknown>
    )(call.threadId, ...agentCallArgs(call));
  // After the commands sent so far are logged: the agent's reply folds after the message it answers.
  const next = pending.then(() => replica.sent()).then(run);
  pending = next.catch(() => {});
  return next;
}

function isLostProcess(error: unknown) {
  return error instanceof Error && error.message.includes(NO_AGENT_PROCESS);
}

function failed(threadId: string, error: unknown): Action {
  return {
    type: 'agent',
    event: {
      threadId,
      type: 'turn-end',
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    },
    ms: Date.now(),
  };
}
