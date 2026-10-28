import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { visibleItem } from './visible.ts';

const ask = { id: 'q1', kind: 'question', threadId: 't1' };
const snapshot = {
  _tag: 'snapshot' as const,
  sequence: 3,
  saved: {
    thread: { id: 't1', activity: [{ text: 'edit', patch: 'diff' }] },
    checkpoints: [{ n: 1 }],
    queue: [ask],
  },
};

test('a read connection sees the thread’s queue but no diffs or checkpoints', () => {
  const item = visibleItem(snapshot, ['read']);
  assert.deepEqual(item, {
    ...snapshot,
    saved: {
      thread: { id: 't1', activity: [{ text: 'edit' }] },
      queue: [ask],
    },
  });
});

test('a code connection gets the snapshot whole', () => {
  assert.equal(visibleItem(snapshot, ['read', 'code']), snapshot);
});
