import { Effect, Layer } from 'effect';
import { parseTitle } from '../../../../src/utility/prompts.ts';
import { utilityCall } from '../agents/handlers.ts';
import { Capabilities } from '../hostServer.ts';
import type { OutboxEffect } from '../store/store.ts';
import { PRIORITY, UtilityQueue } from '../utility/queue.ts';
import type { ReactorCommand, WindowCommand } from './commands.ts';
import { runReactor } from './reactor.ts';
import { Unavailable, type Outcome } from './worker.ts';

/** Capabilities' failures when no window serves `reactor`, or it closed mid-call: retried until one does. */
const isUnserved = (error: unknown) => typeof error === 'string' && (error.startsWith('No connected client') || error.includes('disconnected'));

/** The reactor with its executors: the utility model in Core's queue, everything else in the window that owns the store. */
export const layerReactor = Layer.effectDiscard(
  Effect.gen(function* () {
    const capabilities = yield* Capabilities;
    const queue = yield* UtilityQueue;

    // GAP: the window serving `reactor` holds the store until `replica`; then these become commands Core applies itself.
    const toWindow = (command: WindowCommand) =>
      capabilities.call({ capability: 'reactor', method: 'run', args: [command] }).pipe(
        Effect.timeout('30 seconds'),
        Effect.mapError((error) => (isUnserved(error) ? new Unavailable(error as string) : error)),
        Effect.map((value): Outcome => (value === 'skipped' ? 'skipped' : undefined)),
      );

    const execute = (effect: OutboxEffect) => {
      const command = effect.payload as ReactorCommand;
      if (command.type !== 'title.generate') return toWindow(command);
      const { key, threadId, spaceId, prompt } = command;
      return queue.submit({ thread: threadId, kind: 'title', priority: PRIORITY.title, promptChars: prompt.length, run: utilityCall('title', spaceId, prompt) }).pipe(
        Effect.flatMap((text) => {
          const title = text && parseTitle(text);
          // No model answered, or a newer job replaced this one: the thread keeps its first message as its title.
          return title ? toWindow({ type: 'title.apply', key, threadId, title }) : Effect.succeed<Outcome>(undefined);
        }),
      );
    };

    yield* runReactor(execute);
  }),
);
