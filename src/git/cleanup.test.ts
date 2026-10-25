import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { dueForCleanup } from './cleanup.ts';

const DAY = 24 * 60 * 60 * 1000;

test('a settled worktree is due once it has been seen settled for the chosen days', () => {
  const threads = [
    { id: 'a', status: 'settled' as const },
    { id: 'b', status: 'running' as const },
    { id: 'c', status: 'settled' as const },
  ];
  const paths = { a: '/w/a', b: '/w/b', c: '/w/c' };
  const first = dueForCleanup(threads, paths, {}, 1000, 7);
  assert.deepEqual(first.due, []);
  assert.deepEqual(first.seen, { a: 1000, c: 1000 });
  const later = dueForCleanup(
    threads,
    paths,
    { ...first.seen, c: 1000 + 2 * DAY },
    1000 + 7 * DAY,
    7,
  );
  assert.deepEqual(later.due, [{ threadId: 'a', path: '/w/a' }]);
});

test('a reactivated thread or one with no worktree is forgotten', () => {
  const { due, seen } = dueForCleanup(
    [
      { id: 'a', status: 'running' },
      { id: 'b', status: 'settled' },
    ],
    { a: '/w/a' },
    { a: 0, b: 0 },
    30 * DAY,
    1,
  );
  assert.deepEqual(due, []);
  assert.deepEqual(seen, {});
});
