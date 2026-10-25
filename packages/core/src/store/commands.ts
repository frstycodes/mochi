import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Context, Effect, Layer, Semaphore } from 'effect';
import { COMMAND_TYPE, project } from '@mochi/domain';
import type {
  AgentDecision,
  AgentEvent,
} from '../../../../src/host/types/agent.ts';
import { resolution, undelivered } from '../../../../src/runtime/apply.ts';
import {
  agentCallArgs,
  agentCalls,
  unsentTurns,
  type AgentCall,
} from '../../../../src/runtime/live.ts';
import { setStartEnv } from '../../../../src/runtime/startEnv.ts';
import { withContext } from '../../../../src/store/context.ts';
import type { Action, State } from '../../../../src/store/types.ts';
import type { Thread } from '../../../../src/model.ts';
import { agent } from '../agents/handlers.ts';
import { removeSchedule } from '../schedule/scheduler.ts';
import { Projection } from './projection.ts';
import { Store } from './store.ts';

/** How Core reaches its own agents: the `host.agent.*` handlers windows call, here without a window. */
export class AgentCaller extends Context.Service<
  AgentCaller,
  {
    readonly call: (call: AgentCall) => Effect.Effect<unknown, unknown>;
    readonly resolve: (
      requestId: string,
      decision: AgentDecision,
    ) => Effect.Effect<unknown, unknown>;
  }
>()('mochi/core/AgentCaller') {
  static readonly layer = Layer.succeed(this, {
    call: (call: AgentCall) =>
      Effect.tryPromise(() =>
        (
          agent[call.method] as (
            window: undefined,
            threadId: string,
            ...args: unknown[]
          ) => Promise<unknown>
        )(undefined, call.threadId, ...agentCallArgs(call)),
      ),
    resolve: (requestId: string, decision: AgentDecision) =>
      Effect.tryPromise(() => agent.resolve(undefined, requestId, decision)),
  });
}

/** A thread's worktree as Core knows it: the folder its agent ran in, while that is still on disk and isn't the project folder. */
const worktreeOf = (thread: Pick<Thread, 'repo' | 'live'>) => {
  const cwd = thread.live?.cwd;
  return cwd && cwd !== thread.repo?.path && existsSync(cwd) ? cwd : undefined;
};

// A window knows its worktree paths from main's events; Core reads them off disk, so a cleaned-up worktree is remade on resume.
setStartEnv({
  worktreePath: worktreeOf,
  threadCwd: (thread) =>
    thread.repo
      ? (worktreeOf(thread) ?? thread.repo.path ?? null)
      : (thread.live?.cwd ?? null),
});

/**
 * Core's own dispatch: an action applied as a command in Core's log, with what a window's dispatch sets off for it
 * (`useStoreDispatch` in src/store/index.tsx): the agent calls, the answer to the agent that asked, a deleted thread's
 * trigger. A call that fails ends that turn as failed, so the thread says why. One at a time, so a turn's calls stay in
 * order behind the command they follow. GAP: the OS notification an action addresses (`actedOn`) is a window's to clear.
 */
export class Commands extends Context.Service<Commands>()(
  'mochi/core/Commands',
  {
    make: Effect.gen(function* () {
      const store = yield* Store;
      const projection = yield* Projection;
      const agents = yield* AgentCaller;
      const one = yield* Semaphore.make(1);
      const failed = (threadId: string, error: unknown) => {
        const event: AgentEvent = {
          threadId,
          type: 'turn-end',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
        return store
          .append({ type: `agent.${event.type}`, threadId, payload: event })
          .pipe(Effect.asVoid);
      };

      const apply = (
        action: Action,
        commandId: string = randomUUID(),
      ): Effect.Effect<void, unknown> =>
        one.withPermits(1)(
          Effect.gen(function* () {
            const before = (yield* projection.current)
              .domain as unknown as State;
            const next = project(before, action);
            // A start reads the profile and prefs it runs with from Core's context (`agentOptions`).
            const calls = withContext(before.context, () =>
              agentCalls(before, action, () => next),
            );
            const threadId =
              'threadId' in action && typeof action.threadId === 'string'
                ? action.threadId
                : null;
            // A retry of a command Core already logged made its calls then.
            if (
              (yield* store.append({
                type: COMMAND_TYPE,
                threadId,
                payload: action,
                commandId,
              })).isDuplicate
            )
              return;
            const answer = resolution(before, action);
            if (answer)
              yield* agents.resolve(answer.requestId, answer.decision).pipe(
                Effect.catch((error) =>
                  store.append({
                    type: COMMAND_TYPE,
                    threadId: answer.threadId,
                    payload: {
                      type: 'say',
                      threadId: answer.threadId,
                      entry: undelivered(answer, error),
                    } satisfies Action,
                  }),
                ),
              );
            if (action.type === 'delete')
              for (const id of action.threadIds) yield* removeSchedule(id);
            for (const call of calls)
              yield* agents
                .call(call)
                .pipe(Effect.catch((error) => failed(call.threadId, error)));
            for (const id of unsentTurns(before, next, calls))
              yield* failed(id, 'Mochi had no agent to send this to');
          }),
        );

      return { apply };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
