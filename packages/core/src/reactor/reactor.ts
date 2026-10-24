import { randomUUID } from 'node:crypto';
import { Effect, Stream } from 'effect';
import type { Domain } from '@mochi/domain';
import { Projection, type Folded } from '../store/projection.ts';
import { Store, type OutboxEffect } from '../store/store.ts';
import type { ReactorCommand } from './commands.ts';
import { react, type ReactorState } from './rules.ts';
import { outboxWorker, type Outcome } from './worker.ts';

/**
 * Core's reactor: each event Core's projection folds runs the rules against the state before and after it; the commands they
 * emit go to the outbox, once per key, and `execute` runs them, retried across restarts.
 */
export const runReactor = (execute: (effect: OutboxEffect) => Effect.Effect<Outcome, unknown>) =>
  Effect.gen(function* () {
    const store = yield* Store;
    const projection = yield* Projection;
    // Keys this run already enqueued: a rule emits a due command on every fold, and only the first needs the database.
    const enqueued = new Set<string>();
    const worker = yield* outboxWorker(store, execute, (key) => enqueued.delete(key));
    const boot = randomUUID();
    const stateOf = ({ threads, queue, context }: Domain): ReactorState => ({ threads, queue, context, boot });

    const enqueue = (command: ReactorCommand) =>
      Effect.gen(function* () {
        if (enqueued.has(command.key)) return;
        enqueued.add(command.key);
        const availableAt = command.type === 'limit.resume' ? command.resetsAt : undefined;
        yield* store.enqueue({ commandId: command.key, type: command.type, threadId: command.threadId, payload: command, ...(availableAt && { availableAt }) });
        yield* availableAt ? worker.wakeAt(Date.parse(availableAt)) : worker.wake;
      });

    const onFold = ({ event, before, after }: Folded) =>
      Effect.gen(function* () {
        for (const command of react(event, stateOf(before), stateOf(after))) yield* enqueue(command);
      }).pipe(Effect.catchCause((cause) => Effect.logError(`Reactor failed on ${event.type}`, cause).pipe(Effect.annotateLogs({ source: 'reactor' }))));

    // Started now, so the subscription exists before anything this run folds.
    yield* Effect.forkScoped(Stream.runForEach(projection.folded, onFold), { startImmediately: true });
  });
