import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { toggleSettle, undoLastSettle } from './useSettle.ts';
import type { Thread } from './model.ts';
import type { Action } from './store';

const thread = (id: string, status: string) => ({ id, status }) as Thread;

test('undo reactivates the latest settle, newest first, then reports nothing left', () => {
  const sent: Action[] = [];
  const dispatch = (a: Action) => void sent.push(a);
  toggleSettle([thread('a', 'running')], dispatch);
  toggleSettle([thread('b', 'running'), thread('c', 'running')], dispatch);
  sent.length = 0;
  const now = [
    thread('a', 'settled'),
    thread('b', 'settled'),
    thread('c', 'settled'),
  ];

  assert.equal(undoLastSettle(now, dispatch), true);
  assert.deepEqual(
    sent.map((a) => (a as { threadId: string }).threadId),
    ['b', 'c'],
  );
  assert.equal(sent[0].type, 'unsettle');

  sent.length = 0;
  assert.equal(undoLastSettle([thread('a', 'running')], dispatch), false);
  assert.equal(sent.length, 0);
});
