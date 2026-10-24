import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { Effect } from 'effect';
import { Turns } from './turns.ts';

const run = <A>(body: Effect.Effect<A, unknown, Turns>) => Effect.runPromise(Effect.provide(body, Turns.layer) as Effect.Effect<A>);

test('stopping a turn interrupts it and releases its child processes, pending approval and timer', async () => {
  const released: string[] = [];
  const result = await run(
    Effect.gen(function* () {
      const turns = yield* Turns;
      let timerFired = false;
      // A fake turn: two child processes, a retry timer, then an approval it waits on.
      yield* turns.start('t', ({ ask }) =>
        Effect.gen(function* () {
          for (const name of ['claude', 'mcp-server']) yield* Effect.acquireRelease(Effect.succeed(name), () => Effect.sync(() => released.push(`kill ${name}`)));
          yield* Effect.acquireRelease(
            Effect.sync(() => setTimeout(() => (timerFired = true), 10)),
            (timer) => Effect.sync(() => (clearTimeout(timer), released.push('timer'))),
          );
          yield* ask('approval-1');
          released.push('never: the approval was answered');
        }),
      );
      yield* Effect.yieldNow;
      const waited = turns.isWaiting('t', 'approval-1');
      yield* turns.stop('t');
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)));
      return { waited, timerFired, isRunning: turns.isRunning('t'), isWaiting: turns.isWaiting('t', 'approval-1'), late: yield* turns.answer('t', 'approval-1', 'allow') };
    }),
  );
  assert.deepEqual(result, { waited: true, timerFired: false, isRunning: false, isWaiting: false, late: false });
  assert.deepEqual(released, ['timer', 'kill mcp-server', 'kill claude']);
});

test('an answered approval resumes the turn; a second turn on a busy thread is refused', async () => {
  const result = await run(
    Effect.gen(function* () {
      const turns = yield* Turns;
      let decision: unknown;
      yield* turns.start('t', ({ ask }) => Effect.map(ask('r'), (value) => void (decision = value)));
      yield* Effect.yieldNow;
      const refused = yield* Effect.flip(turns.start('t', () => Effect.void));
      yield* turns.answer('t', 'r', 'allow');
      for (let i = 0; i < 5 && turns.isRunning('t'); i++) yield* Effect.yieldNow;
      return { refused, decision, isRunning: turns.isRunning('t') };
    }),
  );
  assert.deepEqual(result, { refused: 't already has a turn running', decision: 'allow', isRunning: false });
});

