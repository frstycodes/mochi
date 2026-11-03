import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  Context,
  Data,
  Deferred,
  Effect,
  Layer,
  Option,
  Queue,
  Semaphore,
} from 'effect';
import { COMMAND_TYPE, project } from '@mochi/domain';
import {
  NO_AGENT_PROCESS,
  type AgentDecision,
  type AgentEvent,
} from '../../../../apps/desktop/src/host/types/agent.ts';
import { actedOn } from '../../../../apps/desktop/src/notify/slice.ts';
import {
  resolution,
  undelivered,
} from '../../../../apps/desktop/src/runtime/apply.ts';
import {
  agentCallArgs,
  agentCalls,
  resumeAfterLostProcess,
  unsentTurns,
  type AgentCall,
} from '../../../../apps/desktop/src/runtime/live.ts';
import { setStartEnv } from '../../../../apps/desktop/src/runtime/startEnv.ts';
import {
  retargeted,
  scheduleCalls,
} from '../../../../apps/desktop/src/schedule/calls.ts';
import { withContext } from '../../../../apps/desktop/src/store/context.ts';
import type {
  Action,
  State,
} from '../../../../apps/desktop/src/store/types.ts';
import type { Thread } from '../../../../apps/desktop/src/model.ts';
import { agent } from '../agents/handlers.ts';
import { Capabilities } from '../hostServer.ts';
import {
  listSchedules,
  removeSchedule,
  setSchedule,
} from '../schedule/scheduler.ts';
import { Projection } from './projection.ts';
import { Store } from './store.ts';

/** How Core reaches its own agents: the `host.agent.*` handlers windows call, here without a window. */
export class AgentCaller extends Context.Service<
  AgentCaller,
  {
    readonly call: (call: AgentCall) => Effect.Effect<unknown, AgentError>;
    readonly resolve: (
      requestId: string,
      decision: AgentDecision,
    ) => Effect.Effect<unknown, AgentError>;
  }
>()('mochi/core/AgentCaller') {
  static readonly layer = Layer.succeed(this, {
    // The agent's own error, not Effect's wrapper: the failed turn shows its message, and a lost process is told apart by it.
    call: (call: AgentCall) =>
      Effect.tryPromise({
        try: () =>
          (
            agent[call.method] as (
              window: undefined,
              threadId: string,
              ...args: unknown[]
            ) => Promise<unknown>
          )(undefined, call.threadId, ...agentCallArgs(call)),
        catch: toAgentError,
      }),
    resolve: (requestId: string, decision: AgentDecision) =>
      Effect.tryPromise({
        try: () => agent.resolve(undefined, requestId, decision),
        catch: toAgentError,
      }),
  });

  /** Every call succeeds and starts nothing. */
  static readonly layerTest = Layer.succeed(this, {
    call: () => Effect.void,
    resolve: () => Effect.void,
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
 * Core's own dispatch, the one place an action becomes agent calls: the action applied as a command in Core's log, then what
 * it sets off. A start is logged as starting first, so every view shows it until the agent's first word (`heard`); a send that
 * finds the agent's process gone starts it again with the same message; a call that fails ends that turn as failed, so the
 * thread says why. Also the answer to the agent that asked, the thread's schedule trigger, and the OS notification the action
 * addresses. Commands log one at a time; what they set off runs in that order on its own queue.
 */
export class Commands extends Context.Service<Commands>()(
  'mochi/core/Commands',
  {
    make: Effect.gen(function* () {
      const store = yield* Store;
      const projection = yield* Projection;
      const agents = yield* AgentCaller;
      const capabilities = yield* Effect.serviceOption(Capabilities);
      const one = yield* Semaphore.make(1);
      // What commands set off, in the order they were logged: a slow start (a worktree being prepared) holds up the next
      // command's calls, never the logging of commands behind it.
      const effects = yield* Queue.unbounded<Effect.Effect<void>>();
      yield* Queue.take(effects).pipe(
        Effect.flatten,
        Effect.forever,
        Effect.forkScoped,
      );
      const log = (action: Action, threadId: string | null) =>
        store
          .append({ type: COMMAND_TYPE, threadId, payload: action })
          .pipe(Effect.asVoid);
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
      /** The call, logged as starting first when it starts an agent. */
      const call = (agentCall: AgentCall) =>
        Effect.andThen(
          agentCall.method === 'start'
            ? log(
                {
                  type: 'agent-starting',
                  threadId: agentCall.threadId,
                  provider: agentCall.options.provider,
                },
                agentCall.threadId,
              )
            : Effect.void,
          agents.call(agentCall),
        );
      /** A send that found no agent process starts it again with the same message; anything else fails the turn. */
      const callOrResume = (agentCall: AgentCall, next: State) =>
        call(agentCall).pipe(
          Effect.catch((error) => {
            const thread =
              agentCall.method === 'send' && isLostProcess(error)
                ? next.threads.find((t) => t.id === agentCall.threadId)
                : undefined;
            const retry =
              thread && agentCall.method === 'send'
                ? withContext(next.context, () =>
                    resumeAfterLostProcess(thread, agentCall),
                  )
                : [];
            if (retry.length === 0) return failed(agentCall.threadId, error);
            return Effect.forEach(
              retry,
              (again) =>
                call(again).pipe(
                  Effect.catch((e) => failed(again.threadId, e)),
                ),
              { discard: true },
            );
          }),
        );
      const addressed = (threadId: string) =>
        Option.match(capabilities, {
          onNone: () => Effect.void,
          onSome: (c) =>
            c
              .call({
                capability: 'notify',
                method: 'notify.addressed',
                args: [{ threadId, isActedOn: true }],
              })
              .pipe(Effect.ignore),
        });
      const schedule = (before: State, action: Action, next: State) =>
        Effect.gen(function* () {
          const inputs = withContext(next.context, () =>
            scheduleCalls(before, action, () => next),
          );
          for (const input of inputs) yield* setSchedule(input);
          if (action.type === 'delete')
            for (const id of action.threadIds) yield* removeSchedule(id);
          if (action.type !== 'workspace') return;
          const thread = next.threads.find((t) => t.id === action.threadId);
          const trigger = (yield* listSchedules()).find(
            (t) => t.threadId === action.threadId,
          );
          const input =
            thread &&
            withContext(next.context, () => retargeted(thread, trigger));
          if (input) yield* setSchedule(input);
        }).pipe(
          Effect.catch((error) =>
            Effect.logError(`Saving the schedule failed: ${error}`).pipe(
              Effect.annotateLogs({ source: 'commands' }),
            ),
          ),
        );

      /** Logs the command, folded before the next one reads the state; queues what it sets off and returns once logged. */
      const submit = (
        action: Action,
        commandId: string = randomUUID(),
      ): Effect.Effect<
        { sequence: number; isDuplicate: boolean; done: Effect.Effect<void> },
        unknown
      > =>
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
            const logged = yield* store.append({
              type: COMMAND_TYPE,
              threadId,
              payload: action,
              commandId,
            });
            if (logged.isDuplicate) return { ...logged, done: Effect.void };
            // The next command reads the state this one made, not the state before it.
            yield* projection.foldedThrough(logged.sequence);
            const finished = yield* Deferred.make<void>();
            yield* Queue.offer(
              effects,
              setOff(before, action, next, calls).pipe(
                Effect.catchCause((cause) =>
                  Effect.logError(`Acting on ${action.type} failed`, cause),
                ),
                Effect.ensuring(Deferred.succeed(finished, undefined)),
              ),
            );
            return { ...logged, done: Deferred.await(finished) };
          }),
        );

      /** The command's calls and what else it sets off: the answer to the agent that asked, schedules, notifications. */
      const setOff = (
        before: State,
        action: Action,
        next: State,
        calls: ReadonlyArray<AgentCall>,
      ) =>
        Effect.gen(function* () {
          const answer = resolution(before, action);
          if (answer)
            yield* agents.resolve(answer.requestId, answer.decision).pipe(
              Effect.catch((error) =>
                log(
                  {
                    type: 'say',
                    threadId: answer.threadId,
                    entry: undelivered(answer, error),
                  },
                  answer.threadId,
                ),
              ),
            );
          yield* schedule(before, action, next);
          for (const agentCall of calls) yield* callOrResume(agentCall, next);
          for (const id of unsentTurns(before, next, [...calls]))
            yield* failed(id, 'Mochi had no agent to send this to');
          const acted = actedOn(action, before.queue);
          if (acted) yield* addressed(acted);
        });

      /** `submit`, then waits for what the command set off. */
      const apply = (action: Action, commandId?: string) =>
        Effect.gen(function* () {
          const { done, ...logged } = yield* submit(action, commandId);
          yield* done;
          return logged;
        });

      return { apply, submit };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}

export class AgentError extends Data.TaggedError('AgentError')<{
  readonly message: string;
}> {}

const isLostProcess = (error: unknown) =>
  error instanceof AgentError && error.message.includes(NO_AGENT_PROCESS);

const toAgentError = (error: unknown) =>
  new AgentError({
    message: error instanceof Error ? error.message : String(error),
  });
