import { assert, it } from '@effect/vitest';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { Turns } from './turns.ts';

it.effect('stopping a turn interrupts it and releases its child processes, pending approval and timer', () =>
  Effect.gen(function* () {
    const released: string[] = [];
    const turns = yield* Turns;
    let timerFired = false;
    // A fake turn: two child processes, a retry timer, then an approval it waits on.
    yield* turns.start('t', ({ ask }) =>
      Effect.gen(function* () {
        for (const name of ['claude', 'mcp-server']) yield* Effect.acquireRelease(Effect.succeed(name), () => Effect.sync(() => released.push(`kill ${name}`)));
        yield* Effect.acquireRelease(
          Effect.forkDetach(Effect.sleep('10 millis').pipe(Effect.andThen(Effect.sync(() => (timerFired = true))))),
          (timer) => Fiber.interrupt(timer).pipe(Effect.andThen(Effect.sync(() => released.push('timer')))),
        );
        yield* ask('approval-1');
        released.push('never: the approval was answered');
      }),
    );
    yield* Effect.yieldNow;
    const waited = turns.isWaiting('t', 'approval-1');
    yield* turns.stop('t');
    yield* TestClock.adjust('20 millis');
    const result = { waited, timerFired, isRunning: turns.isRunning('t'), isWaiting: turns.isWaiting('t', 'approval-1'), late: yield* turns.answer('t', 'approval-1', 'allow') };
    assert.deepEqual(result, { waited: true, timerFired: false, isRunning: false, isWaiting: false, late: false });
    assert.deepEqual(released, ['timer', 'kill mcp-server', 'kill claude']);
  }).pipe(Effect.provide(Turns.layer)),
);

it.effect('an answered approval resumes the turn; a second turn on a busy thread is refused', () =>
  Effect.gen(function* () {
    const turns = yield* Turns;
    let decision: unknown;
    const turn = yield* turns.start('t', ({ ask }) => Effect.map(ask('r'), (value) => void (decision = value)));
    yield* Effect.yieldNow;
    const refused = yield* Effect.flip(turns.start('t', () => Effect.void));
    yield* turns.answer('t', 'r', 'allow');
    yield* Fiber.await(turn);
    const result = { refused, decision, isRunning: turns.isRunning('t') };
    assert.deepEqual(result, { refused: 't already has a turn running', decision: 'allow', isRunning: false });
  }).pipe(Effect.provide(Turns.layer)),
);
