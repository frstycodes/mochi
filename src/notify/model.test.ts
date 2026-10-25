import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { QueueItem, Step, Thread } from '../model.ts';
import {
  diffNotices,
  groupBursts,
  isAddressed,
  isQuiet,
  type Notice,
} from './model.ts';
import { setPrefs } from '../settings/prefs.ts';

// Goals are retired and default off; their code is kept, so these tests turn them on to keep it honest.
setPrefs({ goals: true });

const step = (rest: Partial<Step> = {}): Step => ({
  id: 's1',
  title: 'Wire gateway',
  status: 'running',
  addedAt: 0,
  addedBy: 'you',
  ...rest,
});
const thread = (rest: Partial<Thread> = {}): Thread =>
  ({
    id: 't',
    spaceId: 'x',
    repo: null,
    title: 'Rate limits',
    goal: '',
    providers: ['claude'],
    status: 'running',
    line: 1,
    startedAt: 0,
    steps: [step()],
    revisions: [],
    activity: [],
    prs: [],
    skills: [],
    sources: [],
    context: { used: 0, max: 1 },
    ...rest,
  }) as Thread;
const item = (rest: Partial<QueueItem>): QueueItem => ({
  id: 'q1',
  kind: 'ci',
  threadId: 't',
  title: 'CI failed',
  detail: 'lint',
  blocks: { steps: 0, threads: 1 },
  createdAt: 0,
  ...rest,
});
const diff = (
  prev: Thread,
  next: Thread,
  queue: { prev?: QueueItem[]; next?: QueueItem[] } = {},
) =>
  diffNotices(
    { threads: [prev], queue: queue.prev ?? [] },
    { threads: [next], queue: queue.next ?? [] },
    10,
  ).map((n) => n.kind);

test('turning needs-you becomes a notice', () => {
  assert.deepEqual(diff(thread(), thread({ status: 'needs-you' })), [
    'needs-you',
  ]);
  assert.deepEqual(
    diff(
      thread({ status: 'needs-you' }),
      thread({ status: 'needs-you', title: 'renamed' }),
    ),
    [],
  );
});

test("a needs-you notice carries the thread's newest question or approval, so its toast opens into it", () => {
  const ask = (rest: Partial<QueueItem>) =>
    item({ kind: 'question', title: 'Stub or record?', ...rest });
  const notice = (queue: QueueItem[]) =>
    diffNotices(
      { threads: [thread()], queue: [] },
      { threads: [thread({ status: 'needs-you' })], queue },
      10,
    )[0];
  const newest = notice([
    ask({ id: 'old', createdAt: 1 }),
    ask({
      id: 'new',
      kind: 'approval',
      title: 'Run the backfill',
      createdAt: 5,
    }),
    ask({ id: 'other', threadId: 'u', createdAt: 9 }),
  ]);
  assert.equal(newest.queueId, 'new');
  assert.equal(newest.body, 'Run the backfill');
  assert.equal(
    notice([ask({ id: 'mochi', tool: { callId: 'c' } }), item({ id: 'ci' })])
      .queueId,
    undefined,
    'Mochi cards and CI are not asks',
  );
  assert.equal(notice([]).body, 'Waiting on your answer');
});

test('a plan item finishing notifies; one dropped does not', () => {
  assert.deepEqual(
    diff(thread(), thread({ steps: [step({ status: 'done' })] })),
    ['step-done'],
  );
  assert.deepEqual(
    diff(thread(), thread({ steps: [step({ status: 'dropped' })] })),
    [],
  );
});

test('new CI queue items notify, old ones and other kinds do not', () => {
  const ci = item({});
  const question = item({ id: 'q3', kind: 'question' });
  const t = thread();
  assert.deepEqual(diff(t, t, { next: [ci, question] }), ['ci']);
  assert.deepEqual(diff(t, t, { prev: [ci], next: [ci] }), []);
});

test('new open PRs ask for review; new threads are not diffed', () => {
  assert.deepEqual(
    diff(thread(), thread({ prs: [{ number: 4, state: 'open', title: 'x' }] })),
    ['pr-review'],
  );
  assert.deepEqual(
    diffNotices(
      { threads: [], queue: [] },
      { threads: [thread({ status: 'needs-you' })], queue: [] },
      1,
    ),
    [],
  );
});

test('bursts fold one thread within 3 minutes, newest first', () => {
  const n = (id: string, threadId: string, at: number): Notice => ({
    id,
    kind: 'step-done',
    threadId,
    title: id,
    body: '',
    at,
    isRead: false,
  });
  const bursts = groupBursts([
    n('a', 't', 1),
    n('b', 't', 3),
    n('c', 'u', 4),
    n('d', 't', 5),
    n('e', 't', 6),
    n('f', 't', 20),
  ]);
  assert.deepEqual(
    bursts.map((b) => b.notices.map((x) => x.id)),
    [['f'], ['e', 'd'], ['c'], ['b', 'a']],
  );
});

test('quiet hours wrap past midnight', () => {
  const at = (h: number) => new Date(2026, 0, 1, h);
  const night = { isOn: true, start: 22, end: 8 };
  assert.equal(isQuiet(night, at(23)), true);
  assert.equal(isQuiet(night, at(7)), true);
  assert.equal(isQuiet(night, at(8)), false);
  assert.equal(isQuiet({ isOn: true, start: 9, end: 17 }, at(12)), true);
  assert.equal(isQuiet({ ...night, isOn: false }, at(23)), false);
});

test('a usage limit notifies what the harness does; going on by itself notifies too, your own stop does not', () => {
  const working = { isWorking: true };
  const running = thread({ status: 'running', live: working });
  const held = thread({
    status: 'running',
    live: {
      ...working,
      limit: {
        resetsAt: '2026-10-13T15:40:00.000Z',
        label: '5-hour',
        isTurnHeld: true,
      },
    },
  });
  const [notice] = diffNotices(
    { threads: [running], queue: [] },
    { threads: [held], queue: [] },
    10,
  );
  assert.equal(notice.kind, 'limit');
  assert.equal(notice.title, 'Rate limits is waiting');
  assert.match(
    notice.body,
    /hit the 5-hour usage limit and continues after the reset at /,
  );
  assert.deepEqual(
    diff(held, running),
    ['limit'],
    'Claude Code went on after the reset',
  );
  assert.deepEqual(
    diff(held, thread({ status: 'running', live: { isWorking: false } })),
    [],
    'you stopped it',
  );

  const stopped = thread({
    status: 'needs-you',
    live: {
      isWorking: false,
      limit: { resetsAt: '2026-10-13T15:40:00.000Z', autoResume: true },
    },
  });
  assert.deepEqual(
    diff(running, stopped),
    ['limit'],
    'no second "needs you" for the same stop',
  );
  assert.deepEqual(
    diff(stopped, running),
    ['limit'],
    'Resume at reset went out',
  );
  assert.deepEqual(
    diff(
      stopped,
      thread({ status: 'running', live: { ...working, isOnApiKey: true } }),
    ),
    [],
    'moving to the API key is your own click',
  );
});

test('one idle notice per turn, once Mochi has gathered its evidence; a failed turn says stalled, not waiting on you', () => {
  const audit = {
    unverified: [{ text: 'Not checked in the app', quote: 'q' }],
  };
  const goal = {
    goal: 'Ship it',
    criteria: [
      { id: 'c', text: 'c', check: { status: 'passed' as const, at: 1 } },
    ],
    live: { isWorking: false },
  };
  const gathering = thread({
    ...goal,
    idle: { at: 1, accepted: [], isGathering: true },
  });
  const gathered = thread({ ...goal, idle: { at: 1, accepted: [], audit } });
  const [notice] = diffNotices(
    { threads: [gathering], queue: [] },
    { threads: [gathered], queue: [] },
    10,
  );
  assert.deepEqual(
    [notice.kind, notice.verdict, notice.title, notice.body],
    ['idle', 'gaps', '1 gap in “Rate limits”', 'Not checked in the app'],
  );
  assert.deepEqual(
    diff(
      gathered,
      thread({ ...goal, idle: { at: 1, accepted: ['x'], audit } }),
    ),
    [],
    'accepting a gap later is no new notice',
  );
  const failed = {
    ...goal,
    status: 'needs-you' as const,
    queuePause: 'failed' as const,
  };
  assert.deepEqual(
    diff(
      thread({ ...failed, idle: { at: 1, accepted: [], isGathering: true } }),
      thread({ ...failed, idle: { at: 1, accepted: [] } }),
    ),
    ['idle'],
  );
  assert.deepEqual(
    diff(thread(goal), thread({ ...failed })),
    [],
    'the turn-end itself waits for the verdict',
  );
});

test('a notice is addressed by what its kind waits for: looking, acting, or the thing it reported being over', () => {
  const viewed = { isViewed: true };
  const acted = { isActedOn: true };
  assert.equal(
    isAddressed({ kind: 'needs-you' }, viewed),
    false,
    'looking does not answer the question',
  );
  assert.equal(isAddressed({ kind: 'needs-you' }, acted), true);
  assert.equal(
    isAddressed(
      { kind: 'needs-you' },
      { thread: thread({ status: 'running' }) },
    ),
    true,
    'answered from the OS notification',
  );
  assert.equal(
    isAddressed(
      { kind: 'needs-you' },
      { thread: thread({ status: 'needs-you' }) },
    ),
    false,
  );
  assert.equal(isAddressed({ kind: 'done' }, viewed), true);
  assert.equal(
    isAddressed({ kind: 'failed' }, viewed),
    false,
    'an error waits for you to act',
  );
  assert.equal(
    isAddressed({ kind: 'idle', verdict: 'stalled' }, viewed),
    false,
  );
  assert.equal(isAddressed({ kind: 'idle', verdict: 'done' }, viewed), true);
  assert.equal(
    isAddressed({ kind: 'ci', queueId: 'q1' }, { queue: [] }),
    true,
    'settled in the Queue',
  );
  assert.equal(
    isAddressed(
      { kind: 'pr-review', prNumber: 4 },
      { thread: thread({ prs: [{ number: 4, state: 'merged', title: 'x' }] }) },
    ),
    true,
  );
  assert.equal(
    isAddressed({ kind: 'step-done' }, {}),
    false,
    'no signal, no change',
  );
});
