import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { AgentEvent } from '../host/types/agent.ts';
import type { Action, State } from '../store/index.tsx';
import type { AutofixEvent } from '../git/autofix.ts';
import { scheduleReducer } from '../schedule/slice.ts';
import { initialQueue, queueReducer } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { agentCalls } from './live.ts';
import { dueWakes, undeliveredReports } from './due.ts';
import { reportPrompt, WAKE_PROMPT } from './subThreadReports.ts';

const run = (s: State, action: Action) =>
  [threadsReducer, queueReducer, scheduleReducer].reduce(
    (acc, slice) => slice(acc, action),
    s,
  );
const agent = (s: State, event: AgentEvent) => run(s, { type: 'agent', event });
/** What the parent's agent gets next: its undelivered report rows, as text. */
const reports = (s: State, threadId: string) =>
  undeliveredReports(s.threads.find((t) => t.id === threadId)!).map((e) =>
    reportPrompt(e.subReport, e.text),
  );
const ended = (s: State, threadId: string) =>
  agent(s, { threadId, type: 'turn-end', status: 'done' });

function family() {
  let s = {
    ...initialThreads(undefined, false),
    ...initialQueue(undefined, false),
    spaceId: 'latitude',
    views: {},
  } as unknown as State;
  const create = (title: string, parentId?: string) => {
    s = run(s, {
      type: 'create',
      title,
      provider: 'claude',
      project: 'harness',
      isLive: true,
      ...(parentId && { parent: { threadId: parentId } }),
    });
    return s.threads.at(-1)!.id;
  };
  const parent = create('Split the work');
  const [a, b] = [create('Piece A', parent), create('Piece B', parent)];
  return {
    s,
    parent,
    a,
    b,
    thread: (state: State, id: string) =>
      state.threads.find((t) => t.id === id)!,
  };
}

test("each turn a sub-thread ends reaches its parent's agent, which wakes once every sub-thread is idle", () => {
  let { s, parent, a, b, thread } = family();
  s = ended(s, parent);
  s = agent(s, {
    threadId: a,
    type: 'message',
    text: 'Piece A is done: added the endpoint.',
    isDelta: false,
  });
  s = ended(s, a);
  assert.match(
    reports(s, parent)[0] ?? '',
    /^Report from sub-thread "Piece A" .*: done\nPiece A is done/,
  );
  assert.deepEqual(dueWakes(s), [], 'Piece B is still working');

  s = ended(s, b);
  assert.equal(reports(s, parent).length, 2);
  assert.equal(
    thread(s, parent).activity.filter((e) => e.subReport).length,
    2,
    "each report is a row in the parent's transcript",
  );
  assert.deepEqual(
    dueWakes(s).map((t) => t.id),
    [parent],
  );

  const wake: Action = { type: 'subthread-wake', threadId: parent };
  const [call] = agentCalls(s, wake, () => run(s, wake));
  assert.equal(call.method, 'send');
  assert.ok(
    call.method === 'send' &&
      call.text.includes('"Piece A"') &&
      call.text.includes('"Piece B"') &&
      call.text.endsWith(WAKE_PROMPT),
  );
  s = run(s, wake);
  assert.deepEqual(reports(s, parent), [], 'the wake delivered them');
  assert.ok(
    thread(s, parent)
      .activity.filter((e) => e.subReport)
      .every((e) => e.subReport!.isDelivered),
    'and they stay in the transcript',
  );
  assert.equal(thread(s, parent).live?.isWorking, true);
  assert.deepEqual(dueWakes(s), []);
});

test("a working parent isn't woken; the reports ride with its next message", () => {
  let { s, parent, a } = family();
  s = ended(s, a);
  assert.deepEqual(dueWakes(s), [], 'the parent is mid-turn');
  const send: Action = {
    type: 'send',
    threadId: parent,
    text: 'go on',
    reason: '',
  };
  const [call] = agentCalls(s, send, () => run(s, send));
  assert.ok(
    call.method === 'send' &&
      call.text.startsWith('Report from sub-thread "Piece A"') &&
      call.text.endsWith('go on'),
  );
});

test("a sub-thread's PR reaches its parent only when it ends or needs a decision, each once", () => {
  let { s, parent, a, b } = family();
  let setup = 0;
  const news = () => reports(s, parent).slice(setup);
  const autofix = (event: AutofixEvent) =>
    (s = run(s, { type: 'autofix', threadId: a, event }));
  const seen = (number: number, state: 'open' | 'merged') =>
    (s = run(s, {
      type: 'prs-seen',
      threadId: a,
      prs: [
        {
          number,
          state,
          title: 'Piece A',
          url: `https://github.com/o/r/pull/${number}`,
        },
      ],
    }));
  s = ended(ended(ended(s, parent), a), b);
  seen(12, 'open');
  seen(13, 'open');
  s = ended(
    run(run(s, { type: 'autofix-set', threadId: a, pr: 12, since: 1 }), {
      type: 'autofix-set',
      threadId: a,
      pr: 13,
      since: 1,
    }),
    a,
  );
  setup = news().length;
  const fixed = (text: string) =>
    (s = ended(
      agent(s, { threadId: a, type: 'message', text, isDelta: false }),
      a,
    ));

  autofix({
    kind: 'ci',
    pr: 12,
    url: 'u',
    head: 'aaa',
    failed: [{ name: 'lint', state: 'fail' }],
    attempt: 1,
  });
  fixed('Fixed lint.');
  autofix({
    kind: 'review',
    pr: 12,
    url: 'u',
    comments: [{ id: '1', author: 'rev', body: 'nit' }],
  });
  fixed('Took the nit.');
  autofix({ kind: 'conflict', pr: 12, url: 'u', head: 'bbb' });
  fixed('Rebased.');
  assert.deepEqual(
    news(),
    [],
    'CI, reviews, a first conflict and the turns fixing them stay with the sub-thread',
  );

  autofix({ kind: 'conflict', pr: 12, url: 'u', head: 'ccc' });
  assert.match(
    news()[0] ?? '',
    /^Report from sub-thread "Piece A" .*: PR #12: merge conflict still there/,
  );
  s = agent(s, { threadId: a, type: 'turn-end', status: 'failed' });
  assert.match(
    news()[1] ?? '',
    /"Piece A" .*: failed/,
    'an Auto-fix turn that fails is news',
  );

  const cap: AutofixEvent = {
    kind: 'stopped',
    pr: 12,
    url: 'u',
    reason: 'cap',
    failed: [{ name: 'lint', state: 'fail' }],
  };
  autofix(cap);
  autofix(cap);
  assert.equal(news().filter((n) => n.includes('needs a decision')).length, 1);

  autofix({ kind: 'stopped', pr: 13, url: 'u', reason: 'merged' });
  seen(13, 'merged');
  seen(12, 'merged');
  assert.deepEqual(
    news()
      .slice(3)
      .map((n) => n.replace(/ \(.*?\)/, '')),
    [
      'Report from sub-thread "Piece A": PR #13: merged',
      'Report from sub-thread "Piece A": PR #12: merged',
    ],
    'merged once, with or without Auto-fix',
  );
  assert.deepEqual(
    dueWakes(s).map((t) => t.id),
    [parent],
    'the escalation wakes an idle parent',
  );
});

const reported = (
  s: State,
  threadId: string,
  report: Extract<Action, { type: 'parent-report' }>['report'],
) => run(s, { type: 'parent-report', threadId, report });

test("a turn's report_to_parent becomes the parent's note, compactly; a turn without one falls back to the excerpt", () => {
  let { s, parent, a } = family();
  s = ended(s, parent);
  s = agent(s, {
    threadId: a,
    type: 'message',
    text: 'A long reply the report replaces.',
    isDelta: false,
  });
  const files = Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`);
  s = reported(s, a, {
    status: 'done',
    summary: 'Added the endpoint.',
    branch: 'piece-a',
    pr: 7,
    changedFiles: files,
    checks: [
      { command: 'pnpm test', result: 'passed' },
      { command: 'pnpm lint', result: 'failed' },
    ],
  });
  s = ended(s, a);
  const [note, ...more] = reports(s, parent);
  assert.deepEqual(more, [], "the turn's end adds nothing to a done report");
  assert.equal(
    note.replace(/ \(.*?\):/, ':'),
    [
      'Report from sub-thread "Piece A": done',
      'Added the endpoint.',
      'Branch piece-a · PR #7',
      `Changed: ${files.slice(0, 10).join(', ')} (+2 more)`,
      'Checks: pnpm test passed; pnpm lint failed',
    ].join('\n'),
  );
  assert.ok(!note.includes('A long reply'));

  s = run(s, { type: 'send', threadId: a, text: 'one more thing', reason: '' });
  s = agent(s, {
    threadId: a,
    type: 'message',
    text: 'Done too.',
    isDelta: false,
  });
  s = ended(s, a);
  assert.match(
    reports(s, parent).at(-1) ?? '',
    /: done\nDone too\./,
    "last turn's report doesn't describe this one",
  );
});

test('blocked, needs_input and failed reports wake the parent at once; done reports wait for every sub-thread', () => {
  for (const status of ['blocked', 'needs_input', 'failed'] as const) {
    let { s, parent, a, thread } = family();
    s = ended(s, parent);
    s = ended(reported(s, a, { status, summary: 'Need the key.' }), a);
    assert.ok(undeliveredReports(thread(s, parent))[0].subReport.isUrgent);
    assert.deepEqual(
      dueWakes(s).map((t) => t.id),
      [parent],
      `${status} doesn't wait for Piece B`,
    );
  }
  let { s, parent, a, b } = family();
  s = ended(s, parent);
  s = ended(reported(s, a, { status: 'done', summary: 'Done.' }), a);
  assert.deepEqual(dueWakes(s), [], 'done batches while Piece B works');
  s = ended(s, b);
  assert.deepEqual(
    dueWakes(s).map((t) => t.id),
    [parent],
  );
});

test('a thread messaged with expectReply replies to the sender at its next turn end, once, and wakes it', () => {
  let { s, parent, a, b, thread } = family();
  s = ended(ended(ended(s, parent), a), b);
  s = run(s, {
    type: 'send',
    threadId: parent,
    text: 'take the reports',
    reason: '',
  });
  s = ended(s, parent);
  const other = run(s, {
    type: 'create',
    title: 'Elsewhere',
    provider: 'claude',
    project: 'harness',
    isLive: true,
  });
  const o = other.threads.at(-1)!.id;
  s = ended(other, o);
  s = run(s, {
    type: 'send',
    threadId: o,
    text: 'Which table?',
    reason: '',
    from: { threadId: parent, title: 'Split the work' },
    expectReply: true,
  });
  s = agent(s, {
    threadId: o,
    type: 'message',
    text: 'The limits table.',
    isDelta: false,
  });
  s = ended(s, o);
  assert.match(
    reports(s, parent).at(-1) ?? '',
    /^Reply from thread "Elsewhere" .*, which ended a turn: done\nThe limits table\.$/,
  );
  assert.equal(thread(s, o).replyTo, undefined);
  assert.deepEqual(
    dueWakes(s).map((t) => t.id),
    [parent],
  );
  const count = reports(s, parent).length;
  s = ended(
    run(s, { type: 'send', threadId: o, text: 'thanks', reason: '' }),
    o,
  );
  assert.equal(reports(s, parent).length, count, 'only the next turn end');
});

test("report_to_parent shows in the parent's transcript at once; a message of yours carries it, with Codex's notes, and marks it delivered", () => {
  let { s, parent, a, thread } = family();
  s = ended(s, parent);
  s = reported(s, a, { status: 'needs_input', summary: 'Which table?' });
  const [row] = thread(s, parent).activity.filter((e) => e.subReport);
  assert.equal(row.kind, 'event');
  assert.equal(row.who, 'harness', 'from the sub-thread, not you');
  assert.deepEqual(
    { ...row.subReport, report: undefined },
    {
      threadId: a,
      title: 'Piece A',
      status: 'needs_input',
      isUrgent: true,
      report: undefined,
    },
  );
  assert.equal(row.text, 'Which table?');
  assert.equal(thread(s, a).live?.isWorking, true, 'logged mid-turn');

  s = {
    ...s,
    threads: s.threads.map((t) =>
      t.id === parent
        ? { ...t, live: { ...t.live!, notes: ['Keep the pins.'] } }
        : t,
    ),
  };
  const send: Action = {
    type: 'send',
    threadId: parent,
    text: 'go on',
    reason: '',
  };
  const [call] = agentCalls(s, send, () => run(s, send));
  assert.ok(call.method === 'send');
  assert.equal(
    call.method === 'send' && call.text.replace(/ \(.*?\):/, ':'),
    'Keep the pins.\n\nReport from sub-thread "Piece A": needs_input\nWhich table?\n\ngo on',
  );
  s = run(s, send);
  assert.deepEqual(reports(s, parent), []);
  assert.equal(thread(s, parent).live?.notes, undefined);
  assert.equal(
    thread(s, parent).activity.find((e) => e.subReport)?.subReport?.isDelivered,
    true,
  );
});
