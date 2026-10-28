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
  // Pins stay on each screen: pinning another computer's thread never reaches it.
  assert.equal(commandFor({ type: 'pin-at', threadId: 't', order: 42 }), null);
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

test('a message to another computer’s thread goes as text; one with images or skills isn’t sent without them', () => {
  const send = {
    type: 'send',
    threadId: 'm1~t',
    text: 'hi',
    reason: '',
  } as const;
  assert.deepEqual(commandFor(send), {
    type: 'send',
    threadId: 'm1~t',
    text: 'hi',
  });
  assert.equal(
    commandFor({ ...send, images: [{ mediaType: 'image/png', data: '' }] }),
    null,
  );
  assert.equal(commandFor({ ...send, skills: ['simplify'] }), null);
});
