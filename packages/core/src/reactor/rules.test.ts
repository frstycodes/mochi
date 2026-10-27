import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { LoggedEvent } from '@mochi/domain';
import type { QueueItem, Thread } from '../../../../apps/desktop/src/model.ts';
import { DEFAULT_CONTEXT } from '../../../../apps/desktop/src/store/context.ts';
import {
  autoSimplify,
  autoTitles,
  compactInstructions,
  delegatedReports,
  idleChecks,
  limitResumes,
  prSync,
  queueRunner,
  react,
  subThreadWakes,
  type ReactorState,
} from './rules.ts';

const idle = { isWorking: false };
const thread = (id: string, fields: Record<string, unknown> = {}) =>
  ({
    id,
    title: id,
    spaceId: 'space',
    status: 'running',
    goal: '',
    activity: [],
    providers: ['claude'],
    live: idle,
    ...fields,
  }) as unknown as Thread;
const state = (
  threads: Thread[],
  queue: QueueItem[] = [],
  boot = 'b1',
  context = DEFAULT_CONTEXT,
): ReactorState => ({ threads, queue, context, boot });
const event = (
  type: string,
  threadId: string | null,
  payload: unknown = null,
  sequence = 7,
): LoggedEvent => ({ sequence, type, threadId, payload });
const saved = (id = 't1') => event('command', id);
const NONE = state([]);

test('queue runner: sends the head of an idle thread queue, not one mid-turn or waiting on an approval', () => {
  const queued = [
    { id: 'm1', draft: 'next' },
    { id: 'm2', draft: 'later' },
  ];
  assert.deepEqual(
    queueRunner(saved(), NONE, state([thread('t1', { queued })])),
    [{ type: 'queue.send', key: 'queue:m1', threadId: 't1', messageId: 'm1' }],
  );
  assert.deepEqual(
    queueRunner(
      saved(),
      NONE,
      state([thread('t1', { queued, live: { isWorking: true } })]),
    ),
    [],
  );
  const approval = {
    id: 'q',
    threadId: 't1',
    kind: 'approval',
  } as unknown as QueueItem;
  assert.deepEqual(
    queueRunner(saved(), NONE, state([thread('t1', { queued })], [approval])),
    [],
  );
});

test('delegated reports: one command per due report, keyed by thread and subagent', () => {
  const subagents = [{ id: 's1', isReportDue: true }, { id: 's2' }];
  assert.deepEqual(
    delegatedReports(saved(), NONE, state([thread('t1', { subagents })])),
    [
      {
        type: 'delegate.report',
        key: 'report:t1:s1',
        threadId: 't1',
        subagentId: 's1',
      },
    ],
  );
});

const report = (
  status: string,
  fields: { isUrgent?: true; isDelivered?: true; isQuiet?: true } = {},
) => ({
  at: 0,
  who: 'harness',
  kind: 'event',
  text: '',
  subReport: { threadId: 'c', title: 'c', status, ...fields },
});
const parent = (activity: unknown[]) =>
  thread('p', { activity, live: { isWorking: false } });
const child = (id: string, isWorking: boolean) =>
  thread(id, { parent: { threadId: 'p' }, live: { isWorking } });

test('sub-thread wakes: an idle parent with undelivered reports and idle children wakes, once per set of reports', () => {
  const [first] = subThreadWakes(
    saved('c'),
    NONE,
    state([parent([report('done')]), child('c', false)]),
  );
  assert.equal(first?.type, 'subthread.wake');
  assert.equal(first?.threadId, 'p');
  assert.deepEqual(
    subThreadWakes(
      saved('c'),
      NONE,
      state([parent([report('done')]), child('c', true)]),
    ),
    [],
    'a working child holds the wake',
  );
  assert.deepEqual(
    subThreadWakes(
      saved('c'),
      NONE,
      state([
        parent([report('done', { isDelivered: true })]),
        child('c', false),
      ]),
    ),
    [],
    'delivered reports wake nobody',
  );
  const [second] = subThreadWakes(
    saved('c'),
    NONE,
    state([
      parent([report('done', { isDelivered: true }), report('failed')]),
      child('c', false),
    ]),
  );
  assert.notEqual(second?.key, first?.key, 'new reports wake it again');
});

test('sub-thread wakes: an urgent report wakes the parent while another child works; done waits', () => {
  const busy = (r: unknown) =>
    subThreadWakes(
      saved('c'),
      NONE,
      state([parent([r]), child('c', false), child('d', true)]),
    );
  assert.equal(busy(report('blocked', { isUrgent: true }))[0]?.threadId, 'p');
  assert.deepEqual(busy(report('done')), []);
});

test('sub-thread wakes: a no_change report never wakes the parent, and leaves the wake key alone', () => {
  const quiet = report('no_change', { isQuiet: true });
  assert.deepEqual(
    subThreadWakes(
      saved('c'),
      NONE,
      state([parent([quiet]), child('c', false)]),
    ),
    [],
    'all idle, only a quiet report',
  );
  const [withQuiet] = subThreadWakes(
    saved('c'),
    NONE,
    state([parent([report('done'), quiet]), child('c', false)]),
  );
  const [without] = subThreadWakes(
    saved('c'),
    NONE,
    state([parent([report('done')]), child('c', false)]),
  );
  assert.equal(withQuiet?.threadId, 'p');
  assert.equal(
    withQuiet?.key,
    without?.key,
    'a quiet report alone makes no new wake',
  );
});

test('limit resumes: armed threads get a resume due at their reset, a new key per reset', () => {
  const armed = (resetsAt: string) =>
    thread('t1', {
      live: { isWorking: false, limit: { autoResume: true, resetsAt } },
    });
  assert.deepEqual(
    limitResumes(saved(), NONE, state([armed('2026-10-25T00:00:00Z')])),
    [
      {
        type: 'limit.resume',
        key: 'resume:t1:2026-10-25T00:00:00Z',
        threadId: 't1',
        resetsAt: '2026-10-25T00:00:00Z',
      },
    ],
  );
  assert.deepEqual(
    limitResumes(
      saved(),
      NONE,
      state([
        thread('t1', { live: { isWorking: false, limit: { resetsAt: 'x' } } }),
      ]),
    ),
    [],
    'not armed',
  );
});

test('auto titles: after the first exchange, never after a rename', () => {
  const activity = [
    { who: 'you', kind: 'message', text: 'add a readme to the repo' },
    { who: 'claude', kind: 'message', text: 'Done.' },
  ];
  const [command] = autoTitles(
    saved(),
    NONE,
    state([thread('t1', { activity })]),
  );
  assert.equal(command?.type, 'title.generate');
  assert.equal(command?.key, 'title:t1');
  assert.ok(
    command?.type === 'title.generate' &&
      command.prompt.includes('add a readme'),
  );
  assert.deepEqual(
    autoTitles(
      saved(),
      NONE,
      state([thread('t1', { activity, isTitleRenamed: true })]),
    ),
    [],
  );
  assert.deepEqual(
    autoTitles(
      saved(),
      NONE,
      state([thread('t1', { activity: activity.slice(0, 1) })]),
    ),
    [],
    'no reply yet',
  );
});

test('compact instructions: live Claude threads only, a new key when the goal changes or Core restarts', () => {
  const claude = (goal: string) =>
    thread('t1', { goal, session: { provider: 'claude' } });
  const [first] = compactInstructions(
    saved(),
    NONE,
    state([claude('ship it')]),
  );
  assert.equal(first?.type, 'compact.instructions');
  assert.equal(
    compactInstructions(saved(), NONE, state([claude('ship it')]))[0]?.key,
    first?.key,
    'same goal, same key',
  );
  assert.notEqual(
    compactInstructions(saved(), NONE, state([claude('ship it twice')]))[0]
      ?.key,
    first?.key,
  );
  assert.notEqual(
    compactInstructions(saved(), NONE, state([claude('ship it')], [], 'b2'))[0]
      ?.key,
    first?.key,
  );
  assert.deepEqual(
    compactInstructions(
      saved(),
      NONE,
      state([thread('t1', { session: { provider: 'codex' } })]),
    ),
    [],
  );
});

test('a setting changed in Core is what its rule reads: goals pick gathering over marking, Simplify › auto gates simplifying', () => {
  const end = event(
    'agent.turn-end',
    't1',
    { type: 'turn-end', status: 'done' },
    42,
  );
  const reply = thread('t1', {
    activity: [
      { who: 'claude', kind: 'message', text: 'one two three four five' },
    ],
  });
  const withPrefs = (prefs: Partial<ReactorState['context']['prefs']>) =>
    state([reply], [], 'b1', {
      ...DEFAULT_CONTEXT,
      prefs: { ...DEFAULT_CONTEXT.prefs, ...prefs },
    });
  assert.deepEqual(idleChecks(end, NONE, withPrefs({ goals: false })), [
    { type: 'idle.mark', key: 'idle:42', threadId: 't1' },
  ]);
  assert.deepEqual(idleChecks(end, NONE, withPrefs({ goals: true })), [
    { type: 'idle.gather', key: 'idle:42', threadId: 't1' },
  ]);
  assert.deepEqual(
    autoSimplify(
      end,
      NONE,
      withPrefs({ simplifyAuto: false, simplifyAutoWords: 3 }),
    ),
    [],
  );
  assert.deepEqual(
    autoSimplify(
      end,
      NONE,
      withPrefs({ simplifyAuto: true, simplifyAutoWords: 3 }),
    ),
    [{ type: 'simplify.auto', key: 'simplify:42', threadId: 't1' }],
  );
  assert.deepEqual(
    autoSimplify(
      end,
      NONE,
      withPrefs({ simplifyAuto: true, simplifyAutoWords: 50 }),
    ),
    [],
    'shorter than the setting asks',
  );
});

test('compact instructions follow your pins in Core: a pin change is a new key', () => {
  const claude = thread('t1', {
    goal: 'ship it',
    session: { provider: 'claude' },
  });
  const pinned = (pins: ReactorState['context']['pins']) =>
    state([claude], [], 'b1', { ...DEFAULT_CONTEXT, pins });
  const [none] = compactInstructions(saved(), NONE, pinned({}));
  const [one] = compactInstructions(
    saved(),
    NONE,
    pinned({ t1: [{ id: 'p', index: 0, text: '' }] }),
  );
  assert.notEqual(one?.key, none?.key);
});

test('PR sync: a tool that pushes or opens a PR refreshes, other tools and tool ends do not', () => {
  const tool = (text: string, phase = 'start') =>
    event('agent.tool', 't1', { type: 'tool', phase, text }, 9);
  assert.deepEqual(prSync(tool('git push -u origin HEAD'), NONE, NONE), [
    { type: 'pr.refresh', key: 'pr:9', threadId: 't1' },
  ]);
  assert.deepEqual(prSync(tool('gh pr create --fill'), NONE, NONE).length, 1);
  assert.deepEqual(prSync(tool('git status'), NONE, NONE), []);
  assert.deepEqual(prSync(tool('git push', 'end'), NONE, NONE), []);
});

test('state rules run on a fold that changed the state, not on a streamed token or an unchanged one', () => {
  const due = state([thread('t1', { queued: [{ id: 'm1', draft: 'next' }] })]);
  assert.deepEqual(
    react(event('agent.turn-end', 't1'), NONE, due).map((c) => c.type),
    ['queue.send', 'idle.mark'],
  );
  assert.deepEqual(
    react(event('agent.message', 't1'), NONE, due),
    [],
    'a token makes nothing due',
  );
  assert.deepEqual(
    react(event('command', 't1'), due, due),
    [],
    'nothing changed',
  );
});
