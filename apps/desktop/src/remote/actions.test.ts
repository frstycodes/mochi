import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { commandFor } from './actions.ts';

test('the shared UI’s actions become the commands that do the same on the machine', () => {
  assert.deepEqual(commandFor({ type: 'answer', queueId: 'q1' }), {
    type: 'resolve',
    queueId: 'q1',
  });
  assert.deepEqual(
    commandFor({ type: 'answer', queueId: 'q1', answers: [['A']] }),
    { type: 'resolve', queueId: 'q1', answers: [['A']] },
  );
  assert.deepEqual(commandFor({ type: 'unsettle', threadId: 't' }), {
    type: 'settle',
    threadId: 't',
    isSettled: false,
  });
  assert.deepEqual(
    commandFor({ type: 'go', view: { kind: 'thread', id: 't' } }),
    { type: 'open', threadId: 't' },
  );
  assert.deepEqual(commandFor({ type: 'delete', threadIds: ['t'] }), {
    type: 'delete',
    threadId: 't',
  });
  assert.deepEqual(commandFor({ type: 'pin-at', threadId: 't', order: 42 }), {
    type: 'pin',
    threadId: 't',
    isPinned: true,
    order: 42,
  });
  assert.deepEqual(
    commandFor({
      type: 'rewind-message',
      threadId: 't',
      index: 3,
      mode: 'chat',
    }),
    {
      type: 'rewind',
      threadId: 't',
      point: { kind: 'message', index: 3 },
      mode: 'chat',
    },
  );
  assert.deepEqual(
    commandFor({ type: 'rewind', threadId: 't', n: 2 }),
    {
      type: 'rewind',
      threadId: 't',
      point: { kind: 'checkpoint', n: 2 },
      mode: 'files',
    },
    'the reducer’s own default',
  );
});

test('what a device can’t do maps to nothing rather than to something close', () => {
  assert.equal(commandFor({ type: 'go', view: { kind: 'queue' } }), null);
  assert.equal(
    commandFor({ type: 'delete', threadIds: ['t', 'u'] }),
    null,
    'one thread at a time, as on the machine’s own menu',
  );
  assert.equal(commandFor({ type: 'pause' }), null);
});
