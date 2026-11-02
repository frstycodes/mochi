import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { Effect, Fiber, Stream } from 'effect';
import { Browsers } from './browsers.ts';

const frame = (n: number) => ({
  data: `data:image/jpeg;base64,${n}`,
  url: 'http://localhost:5173/',
  title: `Frame ${n}`,
});

it.effect(
  'a device subscribed before the first frame gets it; a later one starts at the latest; closing ends both',
  () =>
    Effect.gen(function* () {
      const browsers = yield* Browsers;
      const early = yield* browsers
        .frames('t1', 'tab-1')
        .pipe(Stream.runCollect, Effect.forkChild({ startImmediately: true }));
      yield* browsers.feed('t1', 'tab-1', frame(1));
      yield* browsers.feed('t1', 'tab-1', frame(2));
      const late = yield* browsers
        .frames('t1', 'tab-1')
        .pipe(Stream.runCollect, Effect.forkChild({ startImmediately: true }));
      yield* browsers.feed('t1', 'tab-1', frame(3));
      yield* browsers.close('t1', 'tab-1');
      const lateTitles = [...(yield* Fiber.join(late))].map((f) => f.title);
      const earlyTitles = [...(yield* Fiber.join(early))].map((f) => f.title);
      assert.equal(lateTitles[0], 'Frame 2');
      assert.equal(lateTitles.at(-1), 'Frame 3');
      assert.equal(earlyTitles.at(-1), 'Frame 3');
    }).pipe(Effect.provide(Browsers.layer)),
);

it.effect('another tab of the same thread streams nothing of this one', () =>
  Effect.gen(function* () {
    const browsers = yield* Browsers;
    const other = yield* browsers
      .frames('t1', 'tab-2')
      .pipe(Stream.runCollect, Effect.forkChild({ startImmediately: true }));
    yield* browsers.feed('t1', 'tab-1', frame(1));
    yield* browsers.close('t1', 'tab-2');
    assert.deepEqual([...(yield* Fiber.join(other))], []);
  }).pipe(Effect.provide(Browsers.layer)),
);
