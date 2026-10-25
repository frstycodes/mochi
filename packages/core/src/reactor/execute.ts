import { Effect, Layer } from 'effect';
import { Capabilities as Contract } from '@mochi/schema';
import {
  compactFocus,
  compactInstructions,
  keptContext,
} from '../../../../src/chat/compaction.ts';
import { sendAction } from '../../../../src/chat/queued.ts';
import { threadRoot } from '../../../../src/git/root.ts';
import {
  dueQueued,
  dueReports,
  dueWakes,
} from '../../../../src/runtime/due.ts';
import { dueResumes } from '../../../../src/runtime/limits.ts';
import type { Action, State } from '../../../../src/store/types.ts';
import { hasTempBranch } from '../../../../src/utility/titles.ts';
import { parseTitle } from '../../../../src/utility/prompts.ts';
import { agent, utilityCall } from '../agents/handlers.ts';
import { Capabilities, DISCONNECTED, hostHandlers } from '../hostServer.ts';
import { Commands } from '../store/commands.ts';
import { Projection } from '../store/projection.ts';
import type { OutboxEffect } from '../store/store.ts';
import { PRIORITY, UtilityQueue } from '../utility/queue.ts';
import type { ReactorCommand, WindowCommand } from './commands.ts';
import { runReactor } from './reactor.ts';
import { Unavailable, type Outcome } from './worker.ts';

/** Capabilities' failures when no window serves `reactor`: retried until one does. One that left mid-call already went to the next. */
const isUnserved = (error: unknown) =>
  error instanceof Contract.CapabilityUnavailable || error === DISCONNECTED;

/**
 * The reactor with its executors. Core applies what is a store action to its own log, with the agent calls it means
 * (`Commands`), starts included, and runs the utility model in its queue. A window does only what needs its host or
 * storage: any window serving `reactor`, the latest first (`Capabilities`).
 */
export const layerReactor = Layer.effectDiscard(
  Effect.gen(function* () {
    const capabilities = yield* Capabilities;
    const queue = yield* UtilityQueue;
    const commands = yield* Commands;
    const projection = yield* Projection;
    const host = hostHandlers(capabilities, undefined) as Record<
      string,
      (args: ReadonlyArray<unknown>) => Effect.Effect<unknown, string>
    >;

    const toWindow = (command: WindowCommand) =>
      capabilities
        .call({ capability: 'reactor', method: 'run', args: [command] })
        .pipe(
          Effect.timeout('30 seconds'),
          Effect.mapError((error) =>
            isUnserved(error)
              ? new Unavailable(
                  error instanceof Error ? error.message : String(error),
                )
              : error,
          ),
          Effect.map((value): Outcome =>
            value === 'skipped' ? 'skipped' : undefined,
          ),
        );

    const apply = (
      command: ReactorCommand,
      ...actions: Action[]
    ): Effect.Effect<Outcome, unknown> =>
      Effect.forEach(
        actions,
        (action) => commands.apply(action, `${command.key}:${action.type}`),
        { discard: true },
      );

    const execute = (effect: OutboxEffect): Effect.Effect<Outcome, unknown> =>
      Effect.gen(function* () {
        const command = effect.payload as ReactorCommand;
        const state = (yield* projection.current).domain as unknown as State;
        const thread = state.threads.find((t) => t.id === command.threadId);
        // Not due in the state Core holds now: dropped, and its rule emits it again once it is.
        const skip = Effect.succeed<Outcome>('skipped');
        switch (command.type) {
          case 'queue.send': {
            const message = dueQueued(state).find(
              (due) => due.message.id === command.messageId,
            )?.message;
            if (!thread || !message) return yield* skip;
            const focus = compactFocus(message.draft);
            if (focus !== null)
              return yield* apply(command, {
                type: 'compact',
                threadId: thread.id,
                focus,
                queuedId: message.id,
              });
            const { action, text, verdict } = sendAction(
              state,
              thread,
              message,
              { queuedId: message.id },
            );
            yield* apply(command, action);
            // GAP: an off-goal verdict's new-thread suggestion is a window's card; a send from Core doesn't raise it.
            if (verdict instanceof Promise) {
              const late = yield* Effect.promise(() => verdict);
              if (late.kind !== 'off-goal')
                yield* commands.apply(
                  {
                    type: 'drift-verdict',
                    threadId: thread.id,
                    text,
                    drift: late.kind,
                    reason: late.reason,
                  },
                  `${command.key}:verdict`,
                );
            }
            return;
          }
          case 'delegate.report':
            if (
              !thread ||
              !dueReports([thread]).some(
                (due) => due.subagent.id === command.subagentId,
              )
            )
              return yield* skip;
            return yield* apply(command, {
              type: 'delegate-report',
              threadId: thread.id,
              subagentId: command.subagentId,
            });
          case 'subthread.wake':
            if (!thread || !dueWakes(state).includes(thread))
              return yield* skip;
            return yield* apply(command, {
              type: 'subthread-wake',
              threadId: thread.id,
            });
          case 'limit.resume':
            if (
              !thread ||
              !dueResumes([thread]).length ||
              thread.live?.limit?.resetsAt !== command.resetsAt
            )
              return yield* skip;
            return yield* apply(command, {
              type: 'resume',
              threadId: thread.id,
              atReset: true,
            });
          case 'idle.mark':
            if (!thread?.live) return yield* skip;
            return yield* apply(
              command,
              { type: 'idle-start', threadId: thread.id },
              {
                type: 'idle-update',
                threadId: thread.id,
                patch: { isGathering: false },
              },
            );
          case 'compact.instructions': {
            if (!thread?.live || thread.session?.provider !== 'claude')
              return yield* skip;
            const text = compactInstructions(
              keptContext(thread, state.context.pins[thread.id] ?? []),
            );
            return yield* Effect.tryPromise(() =>
              agent.compactInstructions(undefined, thread.id, text),
            ).pipe(Effect.asVoid);
          }
          case 'title.generate': {
            const { threadId, spaceId, prompt } = command;
            const text = yield* queue.submit({
              thread: threadId,
              kind: 'title',
              priority: PRIORITY.title,
              promptChars: prompt.length,
              run: utilityCall('title', spaceId, prompt),
            });
            const title = text && parseTitle(text);
            // No model answered, or a newer job replaced this one: the thread keeps its first message as its title.
            return title
              ? yield* applyTitle(command.key, threadId, title)
              : undefined;
          }
          default:
            return yield* toWindow(command);
        }
      });

    /** A rename while the model was out wins, title and branch both; the branch follows the title while it's still the temp name. */
    const applyTitle = (key: string, threadId: string, title: string) =>
      Effect.gen(function* () {
        const thread = (yield* projection.current).domain.threads.find(
          (t) => t.id === threadId,
        );
        if (!thread || thread.isTitleRenamed) return;
        yield* commands.apply(
          { type: 'title-generated', threadId, title },
          `${key}:title`,
        );
        const cwd = threadRoot(thread);
        if (!hasTempBranch(thread) || !cwd || cwd === thread.repo?.path) return;
        const branch = yield* host['git.renameAutoBranch']!([
          cwd,
          thread.repo!.branch,
          title,
        ]).pipe(
          // The thread keeps its title; its branch keeps the temp name.
          Effect.catch((error) =>
            Effect.as(
              Effect.logWarning(`Automatic branch not renamed: ${error}`).pipe(
                Effect.annotateLogs({ source: 'reactor' }),
              ),
              null,
            ),
          ),
        );
        if (typeof branch === 'string')
          yield* commands.apply(
            {
              type: 'repo-head',
              threadId,
              head: { branch, isDetached: false },
              worktree: cwd,
            },
            `${key}:branch`,
          );
      });

    yield* runReactor(execute);
  }),
);
