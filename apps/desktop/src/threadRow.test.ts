import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { rowStatusMark } from './threadRow.tsx';
import { STEP_MARKS } from './ui.tsx';

const idle = {
  isWorking: false,
  tone: null,
  status: 'Idle',
  isUnread: false,
} as const;

test('a working row pulses, even when it is unread', () => {
  assert.deepEqual(
    rowStatusMark({
      ...idle,
      isWorking: true,
      status: 'Working',
      isUnread: true,
    }),
    { status: 'running', label: 'Working' },
  );
});

test('warning reads as needs you and destructive as failed, keeping the verdict word', () => {
  assert.deepEqual(
    rowStatusMark({ ...idle, tone: 'warning', status: 'Stalled' }),
    { status: 'needs-you', label: 'Stalled' },
  );
  assert.deepEqual(
    rowStatusMark({ ...idle, tone: 'destructive', status: '2 gaps' }),
    { status: 'failed', label: '2 gaps' },
  );
});

test('unread shows only when the row is not the open thread; a seen idle row has no mark', () => {
  assert.deepEqual(rowStatusMark({ ...idle, isUnread: true }), {
    status: 'unread',
    label: 'Unread',
  });
  assert.equal(rowStatusMark({ ...idle, isUnread: true }, true), null);
  assert.equal(rowStatusMark(idle), null);
  assert.equal(
    rowStatusMark({ ...idle, tone: 'success', status: 'Done' }),
    null,
  );
});

test('steps share the thread marks: blocked is needs you, done is settled', () => {
  assert.deepEqual(STEP_MARKS, {
    done: 'settled',
    running: 'running',
    ready: 'ready',
    blocked: 'needs-you',
    dropped: 'dropped',
  });
});
