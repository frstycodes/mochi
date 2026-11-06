import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Thread } from './model.ts';
import { sidebarGroups } from './reorder.ts';
import { snoozeTimes, wakeLabel, wakeSnoozed } from './snooze.ts';
import { DEFAULT_CONTEXT, withContext } from './store/context.ts';
import type { Action, State } from './store/index.tsx';
import { threadsReducer } from './store/threads.ts';

const at = (y: number, m: number, d: number, h = 9) =>
  new Date(y, m, d, h, 0, 0, 0);

test('next week lands on the coming Monday at 9, never today', () => {
  const nextWeek = (now: Date) => new Date(snoozeTimes(now)[2].at);
  // Thu 29 Oct 2026 → Mon 2 Nov; Sun 1 Nov → Mon 2 Nov; Mon 2 Nov → Mon 9 Nov.
  assert.deepEqual(nextWeek(at(2026, 9, 29, 14)), at(2026, 10, 2));
  assert.deepEqual(nextWeek(at(2026, 10, 1, 14)), at(2026, 10, 2));
  assert.deepEqual(nextWeek(at(2026, 10, 2, 14)), at(2026, 10, 9));
});

test('the wake label names the day only when it is not today', () => {
  const now = at(2026, 9, 30, 14);
  assert.doesNotMatch(
    wakeLabel(at(2026, 9, 30, 17).getTime(), now),
    /tomorrow|\b[A-Z][a-z]{2}\b/,
  );
  assert.match(wakeLabel(at(2026, 9, 31).getTime(), now), /^tomorrow /);
  assert.match(wakeLabel(at(2026, 10, 2).getTime(), now), /^Mon /);
});

const NOW = 1_000_000;
const thread = (patch: Partial<Thread> = {}) =>
  ({
    id: 't',
    spaceId: 's',
    status: 'running',
    startedAt: 0,
    steps: [],
    activity: [{ at: 1 }, { at: 2 }],
    seenActivity: 2,
    prs: [],
    ...patch,
  }) as unknown as Thread;
const wake = (before: Partial<Thread>, after: Partial<Thread> = before) =>
  wakeSnoozed([thread(before)], [thread(after)], NOW)[0];

test('a snooze stays while its time is ahead and the thread asks for nothing', () => {
  const threads = [thread({ snoozedUntil: NOW + 1 })];
  assert.equal(wakeSnoozed(threads, threads, NOW), threads);
  const untilAsked = [thread({ snoozedUntil: 'needs-you' })];
  assert.equal(wakeSnoozed(untilAsked, untilAsked, NOW), untilAsked);
});

test('a snooze whose time came wakes the thread unread, however long ago it came', () => {
  for (const until of [NOW, NOW - 7 * 86_400_000]) {
    const woken = wake({ snoozedUntil: until });
    assert.equal(woken.snoozedUntil, undefined);
    assert.equal(woken.seenActivity, 1);
  }
  // One already unread stays as unread as it was.
  assert.equal(wake({ snoozedUntil: NOW, seenActivity: 0 }).seenActivity, 0);
});

test('starting to ask for you wakes any snooze, read state untouched', () => {
  for (const until of ['needs-you', NOW + 86_400_000] as const) {
    const woken = wake(
      { snoozedUntil: until },
      { snoozedUntil: until, status: 'needs-you' },
    );
    assert.equal(woken.snoozedUntil, undefined);
    assert.equal(woken.seenActivity, 2);
  }
});

test('a live agent stopped on an error or a blocking question asks for you', () => {
  const live = { isWorking: false } as Thread['live'];
  const failed = wake(
    { snoozedUntil: 'needs-you', live },
    { snoozedUntil: 'needs-you', live, queuePause: 'failed' },
  );
  assert.equal(failed.snoozedUntil, undefined);
  const asked = wake(
    { snoozedUntil: 'needs-you', live },
    {
      snoozedUntil: 'needs-you',
      live,
      report: { at: 2, isBlocked: true, ask: 'Which one?' } as Thread['report'],
    },
  );
  assert.equal(asked.snoozedUntil, undefined);
});

test('a thread snoozed while it already asks stays snoozed until it asks anew', () => {
  const asking = { snoozedUntil: 'needs-you', status: 'needs-you' } as const;
  assert.equal(wake(asking).snoozedUntil, 'needs-you');
});

test('settling or pinning ends a snooze', () => {
  const later = NOW + 1;
  assert.equal(
    wake({ snoozedUntil: later, status: 'settled' }).snoozedUntil,
    undefined,
  );
  assert.equal(
    wake({ snoozedUntil: later, orbitSlot: 1 }).snoozedUntil,
    undefined,
  );
});

const state = (threads: Thread[]) =>
  ({
    now: 1,
    threads,
    queue: [],
    checkpoints: {},
    checkpointSeq: 0,
  }) as unknown as State;

/** Folds `action` as Core does, logged at `NOW`: what the fold reads as the wall clock. */
const fold = (s: State, action: Action) =>
  withContext(DEFAULT_CONTEXT, () => threadsReducer(s, action), NOW);

test('the snooze action stores the time, and unset unsnoozes', () => {
  const until = NOW + 3_600_000;
  const snoozed = fold(state([thread()]), {
    type: 'snooze',
    threadId: 't',
    until,
  });
  assert.equal(snoozed.threads[0].snoozedUntil, until);
  const unsnoozed = fold(snoozed, { type: 'snooze', threadId: 't' });
  assert.equal('snoozedUntil' in unsnoozed.threads[0], false);
});

test('any fold after the time passed wakes the thread, as the minute tick does', () => {
  const s = state([thread({ snoozedUntil: NOW - 1 })]);
  const after = fold(s, { type: 'rename', threadId: 't', title: 'x' });
  assert.equal(after.threads[0].snoozedUntil, undefined);
});

test('a snoozed thread leaves Threads for Snoozed with its sub-threads, and comes back on wake', () => {
  const parent = thread({ id: 'p', snoozedUntil: 'needs-you' });
  const sub = thread({ id: 'c', parent: { threadId: 'p' } });
  const other = thread({ id: 'o' });
  const groups = sidebarGroups([parent, sub, other], 's');
  assert.deepEqual(
    groups.active.map((g) => g.thread.id),
    ['o'],
  );
  assert.deepEqual(groups.snoozed, [{ thread: parent, subs: [sub] }]);
  const woken = wakeSnoozed(
    [parent],
    [{ ...parent, status: 'needs-you' }, sub, other],
    NOW,
  );
  assert.deepEqual(sidebarGroups(woken, 's').snoozed, []);
});
