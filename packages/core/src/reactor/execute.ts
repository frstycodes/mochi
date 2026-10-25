import { Effect, Layer } from 'effect';
import {
  compactFocus,
  compactInstructions,
  keptContext,
} from '../../../../apps/desktop/src/chat/compaction.ts';
import { sendAction } from '../../../../apps/desktop/src/chat/queued.ts';
import { threadRoot } from '../../../../apps/desktop/src/git/root.ts';
import {
  dueQueued,
  dueReports,
  dueWakes,
} from '../../../../apps/desktop/src/runtime/due.ts';
import { dueResumes } from '../../../../apps/desktop/src/runtime/limits.ts';
import type {
  Action,
  State,
} from '../../../../apps/desktop/src/store/types.ts';
import { hasTempBranch } from '../../../../apps/desktop/src/utility/titles.ts';
import { parseTitle } from '../../../../apps/desktop/src/utility/prompts.ts';
import { agent, utilityCall } from '../agents/handlers.ts';
import { GitHub } from '../github/service.ts';
import { Capabilities, hostHandlers } from '../hostServer.ts';
import { Commands } from '../store/commands.ts';
import { Projection } from '../store/projection.ts';
import { ThreadContext } from '../switch/context.ts';
import type { OutboxEffect } from '../store/store.ts';
import { PRIORITY, UtilityQueue } from '../utility/queue.ts';
import type { ReactorCommand } from './commands.ts';
import {
  autoSimplify,
  gatherIdle,
  refreshPrs,
  type HostWork,
} from './hostWork.ts';
import { runReactor } from './reactor.ts';
import type { Outcome } from './worker.ts';

export const layerReactor = Layer.effectDiscard(
  Effect.gen(function* () {
    const capabilities = yield* Capabilities;
    const queue = yield* UtilityQueue;
    const commands = yield* Commands;
    const projection = yield* Projection;
    const github = yield* GitHub;
    const context = yield* ThreadContext;
    const host = hostHandlers(capabilities, undefined) as Record<
      string,
      (args: ReadonlyArray<unknown>) => Effect.Effect<unknown, string>
    >;
    const current = Effect.map(
      projection.current,
      ({ domain }) => domain as unknown as State,
    );
    const work: HostWork = {
      apply: (action) => commands.apply(action),
      host: (tag, args) => host[tag]!(args),
      utility: (thread, task, prompt) =>
        queue.submit({
          thread: thread.id,
          kind: task,
          priority: PRIORITY[task],
          promptChars: prompt.length,
          run: utilityCall(task, thread.spaceId, prompt),
        }),
      github,
      current,
    };

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
          case 'idle.gather':
            return yield* gatherIdle(work, state, thread);
          case 'simplify.auto':
            return yield* autoSimplify(work, state, thread);
          case 'pr.refresh':
            return yield* refreshPrs(work, state, thread);
          case 'brief.update':
            if (!thread?.live) return yield* skip;
            return yield* context.updateBrief(thread.id);
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
