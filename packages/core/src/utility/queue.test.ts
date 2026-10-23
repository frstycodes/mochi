import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Effect } from 'effect';
import { PRIORITY, UtilityQueue } from './queue.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const make = () => Effect.runSync(UtilityQueue.make);
const submit = (queue: ReturnType<typeof make>, thread: string, kind: string, priority: number, run: () => Promise<string | null>) =>
  Effect.runPromise(queue.submit({ thread, kind, priority, promptChars: 40, run: Effect.promise(run) }));

test('waiting jobs run by priority then arrival, one at a time', async () => {
  const queue = make();
  const order: string[] = [];
  let running = 0;
  let peak = 0;
  const record = (name: string) => async () => {
    peak = Math.max(peak, ++running);
    await sleep(5);
    order.push(name);
    running--;
    return name;
  };
  let release!: () => void;
  const held = submit(queue, 'hold', 'hold', 9, () => new Promise((resolve) => (release = () => resolve('held'))));
  await sleep(5);
  const rest = Promise.all([
    submit(queue, 't1', 'simplify', PRIORITY.simplify, record('simplify')),
    submit(queue, 't2', 'audit', PRIORITY.audit, record('audit')),
    submit(queue, 't3', 'classify', PRIORITY.classify, record('classify')),
    submit(queue, 't4', 'audit', PRIORITY.audit, record('audit-later')),
  ]);
  await sleep(5);
  release();
  await Promise.all([held, rest]);
  assert.deepEqual(order, ['classify', 'audit', 'audit-later', 'simplify']);
  assert.equal(peak, 1);
});

test('a newer job for the same (thread, kind) replaces the older, queued or running', async () => {
  const queue = make();
  const never = () => new Promise<string | null>(() => {});
  const running = submit(queue, 't', 'title', 1, never);
  await sleep(5);
  const queued = submit(queue, 'u', 'title', 1, async () => 'old');
  const blocked = submit(queue, 'v', 'title', 1, async () => 'v');
  await sleep(5);
  // `queued` waits behind `running`; replacing both lets the newer ones through.
  const newerRunning = submit(queue, 't', 'title', 1, async () => 'new');
  const newerQueued = submit(queue, 'u', 'title', 1, async () => 'newer');
  assert.equal(await running, null);
  assert.equal(await queued, null);
  assert.equal(await newerRunning, 'new');
  assert.equal(await newerQueued, 'newer');
  assert.equal(await blocked, 'v');
  const stats = Effect.runSync(queue.stats);
  assert.equal(stats.replaced, 2);
  assert.ok(stats.tokensIn > 0);
});
