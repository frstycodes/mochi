import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Thread } from '../model.ts';
import type { Action, State } from '../store/types.ts';
import { notificationsReducer } from './slice.ts';

const thread = (patch: Partial<Thread> = {}) =>
  ({
    id: 't',
    spaceId: 's',
    title: 'Rate limits',
    status: 'running',
    startedAt: 0,
    steps: [{ id: 's1', title: 'Wire gateway', status: 'running' }],
    activity: [],
    prs: [],
    ...patch,
  }) as unknown as Thread;
const done = { steps: [{ id: 's1', title: 'Wire gateway', status: 'done' }] };

/** The kinds of notice the slice raises when `before` becomes `after`. */
function notices(before: Thread, after: Thread) {
  const state = {
    now: 10,
    threads: [after],
    queue: [],
    notifications: {
      items: [],
      seen: { threads: [before], queue: [] },
      muted: [],
      quiet: { isOn: false, start: 22, end: 8 },
    },
  } as unknown as State;
  const action = { type: 'rename', threadId: 't', title: 'x' } as Action;
  return notificationsReducer(state, action).notifications.items.map(
    (n) => n.kind,
  );
}

test('a snoozed thread raises no notices; awake, the same change does', () => {
  assert.deepEqual(notices(thread(), thread(done as Partial<Thread>)), [
    'step-done',
  ]);
  const snoozed = { snoozedUntil: 'needs-you' } as const;
  assert.deepEqual(
    notices(
      thread(snoozed),
      thread({ ...snoozed, ...done } as Partial<Thread>),
    ),
    [],
  );
});
