import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandFor } from './actions.ts';

test('the shared UI’s actions become the commands that do the same on the machine', () => {
  assert.deepEqual(commandFor({ type: 'answer', queueId: 'q1' }), { type: 'resolve', queueId: 'q1' });
  assert.deepEqual(commandFor({ type: 'answer', queueId: 'q1', answers: [['A']] }), { type: 'resolve', queueId: 'q1', answers: [['A']] });
  assert.deepEqual(commandFor({ type: 'unsettle', threadId: 't' }), { type: 'settle', threadId: 't', isSettled: false });
  assert.deepEqual(commandFor({ type: 'go', view: { kind: 'thread', id: 't' } }), { type: 'open', threadId: 't' });
});

test('what a device can’t do maps to nothing rather than to something close', () => {
  assert.equal(commandFor({ type: 'go', view: { kind: 'queue' } }), null);
  assert.equal(commandFor({ type: 'delete', threadIds: ['t'] }), null);
  assert.equal(commandFor({ type: 'pause' }), null);
});
