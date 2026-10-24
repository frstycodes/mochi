import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Starts } from './starts.ts';

test('a message sent during setup waits for the start instead of finding no agent', async () => {
  const starts = new Starts();
  const start = starts.begin('t1');
  const order: string[] = [];
  const send = starts.wait('t1').then(() => order.push('send'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(order.length, 0, 'still setting up: the send is held');
  order.push('agent started');
  start.end();
  await send;
  assert.deepEqual(order, ['agent started', 'send']);
  assert.equal(starts.isStarting('t1'), false);
  await starts.wait('t1');
});

test('interrupt aborts the setup; Retry / Skip answer only a waiting step', async () => {
  const starts = new Starts();
  const start = starts.begin('t1');
  assert.equal(starts.choose('t1', 'retry'), false, 'nothing failed yet');
  const answer = start.choose();
  assert.equal(starts.choose('t1', 'skip'), true);
  assert.equal(await answer, 'skip');
  assert.equal(starts.abort('t1'), true);
  assert.equal(start.signal.aborted, true);
  start.end();
  assert.equal(starts.abort('t1'), false, 'no setup left to stop: the interrupt goes to the agent');
});

test('a second start of the same thread stops the first one', () => {
  const starts = new Starts();
  const first = starts.begin('t1');
  const second = starts.begin('t1');
  assert.equal(first.signal.aborted, true);
  first.end();
  assert.equal(starts.isStarting('t1'), true, "the first start's end leaves the second in place");
  second.end();
  assert.equal(starts.isStarting('t1'), false);
});
