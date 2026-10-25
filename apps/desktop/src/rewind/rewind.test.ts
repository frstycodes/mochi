import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vite-plus/test';
import type { State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, mapThread, threadsReducer } from '../store/threads.ts';
import type { Action } from '../store/index.tsx';
import { applyAgentEvent } from '../runtime/apply.ts';
import { agentCalls, resumeAfterLostProcess } from '../runtime/live.ts';
import { rewindBlockedReason, threadAt } from './checkpoints.ts';
import { forkRelatives } from './fork.ts';
import { failDrafts, handoffSummary } from './handoff.ts';
import { draftHandoff } from './runHandoff.ts';
import { host } from '../host/index.ts';
import { utilityCore } from '../utility/runUtility.ts';

afterEach(() => vi.restoreAllMocks());

const base = () =>
  ({
    ...initialThreads(),
    ...initialQueue(),
    spaceId: 'latitude',
    views: {},
  }) as unknown as State;
const thread = (s: State, id: string) => s.threads.find((t) => t.id === id)!;
const tickUntil = (s: State, done: (s: State) => boolean) => {
  for (let i = 0; i < 500 && !done(s); i++)
    s = threadsReducer(s, { type: 'tick' });
  return s;
};
/** A demo thread works while it's running; rewinds wait for it to stop. */
const idle = (s: State, id: string): State => ({
  ...s,
  threads: mapThread(s.threads, id, (t) => ({ ...t, status: 'review' })),
});
const calls = (s: State, action: Action) =>
  agentCalls(s, action, () => threadsReducer(s, action));

test('threadAt rebuilds steps, activity and revisions as they stood', () => {
  const rl = thread(base(), 'rl');
  const past = threadAt(rl, rl.startedAt + 30);
  assert.deepEqual(past.steps.map((s) => s.status).slice(0, 2), [
    'done',
    'running',
  ]);
  assert.ok(
    !past.steps.some((s) => s.id === 'rl7'),
    'step added at v2 is not there yet',
  );
  assert.ok(past.activity.every((a) => a.at <= rl.startedAt + 30));
  assert.equal(past.revisions.length, 1);
  assert.equal(past.status, 'running');
});

test('seeded threads get a start checkpoint plus one per finished step', () => {
  const s = base();
  assert.deepEqual(
    s.checkpoints.rl.map((c) => c.label),
    [
      'Start',
      'After "Agree limit tiers per plan"',
      'After "Design limits schema"',
      'After "Wire limits into gateway config"',
    ],
  );
  const ns = Object.values(s.checkpoints)
    .flat()
    .map((c) => c.n);
  assert.equal(new Set(ns).size, ns.length, 'checkpoint numbers are unique');
});

test('a finished step records a checkpoint that asks for files', () => {
  const s0 = base();
  const s = tickUntil(
    s0,
    (s) => thread(s, 'rl').steps.find((x) => x.id === 'rl5')!.status === 'done',
  );
  const last = s.checkpoints.rl.at(-1)!;
  assert.equal(last.stepId, 'rl5');
  assert.equal(last.wantsFiles, true);
  assert.equal(last.thread.steps.find((x) => x.id === 'rl5')!.status, 'done');
});

test('rewind restores the snapshot, drops later checkpoints, and one undo brings it all back', () => {
  let s = tickUntil(
    base(),
    (s) => thread(s, 'rl').steps.find((x) => x.id === 'rl5')!.status === 'done',
  );
  s = idle(s, 'rl');
  const before = thread(s, 'rl');
  const target = s.checkpoints.rl[1];
  s = threadsReducer(s, { type: 'rewind', threadId: 'rl', n: target.n });
  const rewound = thread(s, 'rl');
  assert.equal(rewound.steps.filter((x) => x.status === 'done').length, 1);
  assert.equal(
    rewound.activity.at(-1)!.text,
    'Rewound transcript to after "Agree limit tiers per plan"',
  );
  assert.equal(
    rewound.revisions.at(-1)!.label,
    'Rewound to after "Agree limit tiers per plan"',
  );
  assert.ok(
    rewound.steps
      .filter((x) => x.status === 'running')
      .every((x) => x.startedAt === s.now),
    'running steps restart their clock',
  );
  assert.equal(s.checkpoints.rl.at(-1)!.n, target.n);
  assert.equal(
    threadsReducer(s, { type: 'rewind-undo' }),
    s,
    'the demo agent works again, so undo waits',
  );
  s = threadsReducer(idle(s, 'rl'), { type: 'rewind-undo' });
  const back = thread(s, 'rl');
  assert.deepEqual(back.steps, before.steps);
  assert.equal(back.activity.length, before.activity.length + 1);
  assert.equal(s.rewindUndo, null);
  assert.equal(threadsReducer(s, { type: 'rewind-undo' }), s, 'only one undo');
});

test('fork copies context up to a message, on a new branch, and records where it came from', () => {
  let s = base();
  const parent = thread(s, 'adm');
  const index = 4;
  s = threadsReducer(s, {
    type: 'fork',
    threadId: 'adm',
    point: { kind: 'message', index },
  });
  const child = s.threads.find((t) => t.id.startsWith('fork-'))!;
  assert.equal(s.forks[child.id].parentId, 'adm');
  assert.equal(
    child.activity.length,
    index + 2,
    'messages up to the fork point plus the fork event',
  );
  assert.equal(child.repo!.branch, `${parent.repo!.branch}-fork-1`);
  assert.notEqual(child.line, parent.line);
  assert.ok(
    child.steps.every((st) => !parent.steps.some((p) => p.id === st.id)),
    'step ids are the fork’s own',
  );
  assert.match(thread(s, 'adm').activity.at(-1)!.text, /^Forked to/);
  assert.deepEqual(
    s.checkpoints[child.id].map((c) => c.label),
    ['Fork point'],
  );
  assert.deepEqual(
    forkRelatives(s, 'adm').map((t) => t.id),
    [child.id],
  );
  assert.deepEqual(
    forkRelatives(s, child.id).map((t) => t.id),
    ['adm'],
  );

  s = threadsReducer(s, { type: 'fork-keep', keepId: child.id, dropId: 'adm' });
  assert.equal(thread(s, 'adm').status, 'settled');
  assert.equal(forkRelatives(s, child.id).length, 0);
});

test('fork from a checkpoint names it for the worktree only once its files were saved', () => {
  let s = base();
  const cp = s.checkpoints.adm[1];
  s = threadsReducer(s, {
    type: 'fork',
    threadId: 'adm',
    point: { kind: 'checkpoint', n: cp.n },
  });
  assert.equal(Object.values(s.forks)[0].checkpoint, undefined);
  s = threadsReducer(base(), {
    type: 'checkpoint-ref',
    threadId: 'adm',
    n: cp.n,
    ref: 'abc',
  });
  s = threadsReducer(s, {
    type: 'fork',
    threadId: 'adm',
    point: { kind: 'checkpoint', n: cp.n },
  });
  assert.equal(Object.values(s.forks)[0].checkpoint, cp.n);
});

test('handoff moves the thread and logs one handoff row with its prompt, not a message or a revision', () => {
  let s = base();
  const rl = thread(s, 'rl');
  const summary = handoffSummary(rl, 'codex', {
    files: 3,
    added: 40,
    removed: 6,
  });
  assert.match(summary, /Goal:\*\* Every public API key/);
  assert.match(summary, /Add Redis client \(running\)/);
  assert.match(summary, /3 files, \+40 −6/);

  s = threadsReducer(s, {
    type: 'handoff',
    threadId: 'rl',
    to: 'codex',
    summary,
  });
  const t = thread(s, 'rl');
  assert.deepEqual(t.providers, ['codex', 'claude']);
  assert.equal(
    t.revisions.length,
    rl.revisions.length,
    'what done means is unchanged',
  );
  assert.equal(
    t.activity.length,
    rl.activity.length + 1,
    'one row, no summary message beside it',
  );
  assert.deepEqual(t.activity.at(-1), {
    at: s.now,
    who: 'harness',
    kind: 'event',
    text: 'Handed off from Claude to Codex',
    handoff: {
      from: 'claude',
      to: 'codex',
      status: 'started',
      prompt: summary,
    },
  });
});

test('a drafted handoff fills its drafting row; a second draft waits; a handoff to the same agent fails the row', () => {
  let s = threadsReducer(base(), {
    type: 'handoff-draft',
    threadId: 'rl',
    to: 'codex',
  });
  const drafting = thread(s, 'rl');
  assert.deepEqual(
    drafting.providers[0],
    'claude',
    'the thread stays put while the prompt drafts',
  );
  assert.deepEqual(drafting.activity.at(-1)!.handoff, {
    from: 'claude',
    to: 'codex',
    status: 'drafting',
  });
  assert.equal(
    thread(
      threadsReducer(s, { type: 'handoff-draft', threadId: 'rl', to: 'codex' }),
      'rl',
    ).activity.length,
    drafting.activity.length,
    'one draft at a time',
  );

  s = threadsReducer(s, { type: 'tick' });
  s = threadsReducer(s, {
    type: 'handoff',
    threadId: 'rl',
    to: 'codex',
    summary: 'Pick up the Redis client',
    fallback: 'timeout',
  });
  const handed = thread(s, 'rl');
  const row = handed.activity.find((e) => e.handoff)!;
  assert.equal(
    row.at,
    drafting.activity.at(-1)!.at,
    'the row stays where the handoff began',
  );
  assert.equal(row.text, 'Handed off from Claude to Codex');
  assert.deepEqual(row.handoff, {
    from: 'claude',
    to: 'codex',
    status: 'started',
    prompt: 'Pick up the Redis client',
    fallback: 'timeout',
  });
  assert.equal(handed.activity.filter((e) => e.handoff).length, 1);

  s = threadsReducer(s, {
    type: 'handoff-draft',
    threadId: 'rl',
    to: 'claude',
  });
  s = threadsReducer(s, {
    type: 'handoff',
    threadId: 'rl',
    to: 'codex',
    summary: 'x',
  });
  assert.deepEqual(thread(s, 'rl').activity.at(-1)!.handoff, {
    from: 'codex',
    to: 'claude',
    status: 'failed',
    error: 'Already on Codex',
  });
  assert.deepEqual(thread(s, 'rl').providers[0], 'codex');
});

test('a thread settled while its handoff drafts stays settled on its agent, and the row fails', () => {
  const create: Action = {
    type: 'create',
    title: 'reply with ok',
    provider: 'claude',
    project: 'harness',
    isLive: true,
  };
  let s = threadsReducer(base(), create);
  const id = s.threads.at(-1)!.id;
  s = threadsReducer(s, { type: 'handoff-draft', threadId: id, to: 'codex' });
  s = threadsReducer(s, { type: 'settle', threadId: id });
  const handoff: Action = {
    type: 'handoff',
    threadId: id,
    to: 'codex',
    summary: 'x',
  };
  assert.deepEqual(calls(s, handoff), [], 'no agent stops or starts');
  const t = thread(threadsReducer(s, handoff), id);
  assert.deepEqual([t.status, t.providers[0]], ['settled', 'claude']);
  assert.deepEqual(t.activity.findLast((e) => e.handoff)!.handoff, {
    from: 'claude',
    to: 'codex',
    status: 'failed',
    error: 'The thread was settled',
  });
});

test('a draft that throws or outlives the window fails its row', () => {
  let s = threadsReducer(base(), {
    type: 'handoff-draft',
    threadId: 'rl',
    to: 'codex',
  });
  s = threadsReducer(s, {
    type: 'handoff-fail',
    threadId: 'rl',
    error: 'boom',
  });
  assert.deepEqual(thread(s, 'rl').activity.at(-1)!.handoff?.status, 'failed');
  assert.equal(
    thread(s, 'rl').activity.at(-1)!.text,
    'Could not hand off from Claude to Codex',
  );

  const open = threadsReducer(base(), {
    type: 'handoff-draft',
    threadId: 'rl',
    to: 'codex',
  });
  const [failed] = failDrafts(
    thread(open, 'rl').activity.slice(-1),
    'Stopped when Mochi quit',
  );
  assert.deepEqual(failed.handoff, {
    from: 'claude',
    to: 'codex',
    status: 'failed',
    error: 'Stopped when Mochi quit',
  });
  const done = thread(base(), 'rl').activity;
  assert.equal(failDrafts(done, 'x'), done, 'nothing open, same array');
});

test('draftHandoff uses the model draft, else the local summary on an error or past the timeout', async () => {
  const rl = thread(base(), 'rl');
  vi.spyOn(host.git, 'diff').mockImplementation(async () => ({
    branch: '',
    base: '',
    files: [],
  }));
  const utility = vi
    .spyOn(utilityCore, 'call')
    .mockImplementation(async () => '```\nDrafted\n```' as never);
  assert.deepEqual(await draftHandoff(rl, 'codex'), { prompt: 'Drafted' });
  utility.mockImplementation(async () => null as never);
  const failed = await draftHandoff(rl, 'codex');
  assert.equal(failed.fallback, 'error');
  assert.match(failed.prompt, /\*\*Handoff to Codex\*\*/);
  utility.mockImplementation(() => new Promise<never>(() => {}));
  assert.equal((await draftHandoff(rl, 'codex', 5)).fallback, 'timeout');
});

test('rewinding to a message drops it and everything after, keeps what came before, and undoes in one step', () => {
  let s = idle(base(), 'rl');
  const before = thread(s, 'rl');
  const index = before.activity.findIndex(
    (a) => a.who === 'you' && a.text.startsWith('Also add per-key overrides'),
  );
  s = threadsReducer(s, { type: 'rewind-message', threadId: 'rl', index });
  const rewound = thread(s, 'rl');
  const kept = rewound.activity.slice(0, -1);
  assert.deepEqual(
    kept,
    before.activity.slice(0, index),
    'transcript stops right before the message',
  );
  assert.match(
    rewound.activity.at(-1)!.text,
    /^Rewound transcript to before "Also add per-key overrides/,
  );
  assert.ok(
    !rewound.steps.some((x) => x.id === 'rl7'),
    'the step that message added is gone',
  );
  s = threadsReducer(idle(s, 'rl'), { type: 'rewind-undo' });
  assert.deepEqual(thread(s, 'rl').steps, before.steps);
});

/** A live Claude thread that has finished two turns, each started by one of your messages, with its files saved before each. */
function liveThread() {
  let s = base();
  s = threadsReducer(s, {
    type: 'create',
    title: 'edit notes.txt',
    provider: 'claude',
    project: 'harness',
    isLive: true,
  });
  const id = s.threads.at(-1)!.id;
  const turn = (text: string) => {
    s = applyAgentEvent(s, {
      threadId: id,
      type: 'message',
      text,
      isDelta: false,
    });
    s = applyAgentEvent(s, { threadId: id, type: 'turn-end', status: 'done' });
  };
  s = applyAgentEvent(s, {
    threadId: id,
    type: 'session',
    provider: 'claude',
    sessionId: 'sess-1',
  });
  turn('Wrote one.');
  s = threadsReducer(s, {
    type: 'send',
    threadId: id,
    text: 'Now write two',
    drift: 'on-goal',
    reason: '',
  });
  turn('Wrote two.');
  for (const c of s.checkpoints[id])
    s = threadsReducer(s, {
      type: 'checkpoint-ref',
      threadId: id,
      n: c.n,
      ref: `ref-${c.n}`,
    });
  const index = thread(s, id).activity.findIndex(
    (a) => a.text === 'Now write two',
  );
  return { s, id, index };
}

test('a working agent blocks every rewind and the undo until its turn ends', () => {
  let { s, id, index } = liveThread();
  const working = threadsReducer(s, {
    type: 'send',
    threadId: id,
    text: 'and three',
    drift: 'on-goal',
    reason: '',
  });
  assert.equal(
    rewindBlockedReason(thread(working, id)),
    'Stop the agent to rewind',
  );
  assert.equal(
    threadsReducer(working, {
      type: 'rewind-message',
      threadId: id,
      index,
      mode: 'chat',
    }),
    working,
    'message rewind refused',
  );
  assert.equal(
    threadsReducer(working, {
      type: 'rewind',
      threadId: id,
      n: working.checkpoints[id][0].n,
    }),
    working,
    'checkpoint rewind refused',
  );

  s = threadsReducer(s, {
    type: 'rewind-message',
    threadId: id,
    index,
    mode: 'chat',
  });
  const rewound = threadsReducer(s, {
    type: 'send',
    threadId: id,
    text: 'try again',
    drift: 'on-goal',
    reason: '',
  });
  assert.equal(
    threadsReducer(rewound, { type: 'rewind-undo' }),
    rewound,
    'undo refused while the agent works',
  );
  const done = applyAgentEvent(rewound, {
    threadId: id,
    type: 'turn-end',
    status: 'done',
  });
  assert.equal(rewindBlockedReason(thread(done, id)), undefined);
  assert.notEqual(
    threadsReducer(done, { type: 'rewind-undo' }),
    done,
    'undo runs once the turn ended',
  );
});

test('each of your messages saves a checkpoint of the files it found', () => {
  const { s, id, index } = liveThread();
  const cp = s.checkpoints[id].find((c) => c.before === index)!;
  assert.equal(cp.label, 'Before "Now write two"');
  assert.equal(cp.thread.activity.length, index);
});

test('rewind chat: transcript back, files untouched, the agent stops and its next start forks the session at that point', () => {
  const { s: s0, id, index } = liveThread();
  const action: Action = {
    type: 'rewind-message',
    threadId: id,
    index,
    mode: 'chat',
    forkAt: 'uuid-after-one',
  };
  assert.deepEqual(calls(s0, action), [{ method: 'stop', threadId: id }]);
  const s = threadsReducer(s0, action);
  const t = thread(s, id);
  assert.ok(
    !t.activity.some(
      (a) => a.text === 'Now write two' || a.text === 'Wrote two.',
    ),
  );
  assert.match(
    t.activity.at(-1)!.text,
    /^Rewound transcript to before "Now write two"/,
  );
  assert.equal(
    s.rewindUndo!.hasFiles,
    false,
    'files stay, so undo leaves them too',
  );
  assert.deepEqual(t.live!.restart, { forkAt: 'uuid-after-one' });
  assert.equal(t.session!.id, 'sess-1');
  const [start] = calls(s, {
    type: 'send',
    threadId: id,
    text: 'Now write 2',
    drift: 'on-goal',
    reason: '',
  });
  assert.equal(start.method, 'start');
  assert.deepEqual(
    start.method === 'start' && [
      start.options.resume,
      start.options.forkAt,
      start.options.prompt,
    ],
    ['sess-1', 'uuid-after-one', 'Now write 2'],
  );
});

test('rewind → fork fails → send again, or the process is lost: the fork point goes to main once, never on a later start', () => {
  const { s: s0, id, index } = liveThread();
  let s = threadsReducer(s0, {
    type: 'rewind-message',
    threadId: id,
    index,
    mode: 'chat',
    forkAt: 'uuid-after-one',
  });
  const send: Action = {
    type: 'send',
    threadId: id,
    text: 'Now write 2',
    drift: 'on-goal',
    reason: '',
  };
  const [fork] = calls(s, send);
  assert.equal(
    fork.method === 'start' && fork.options.forkAt,
    'uuid-after-one',
  );
  s = threadsReducer(s, send);
  s = applyAgentEvent(s, {
    threadId: id,
    type: 'turn-end',
    status: 'failed',
    error: 'No message found with message.uuid of: uuid-after-one',
  });
  assert.equal(thread(s, id).live!.restart, undefined);
  const again: Action = {
    type: 'send',
    threadId: id,
    text: 'try again',
    drift: 'on-goal',
    reason: '',
  };
  assert.deepEqual(
    calls(s, again),
    [{ method: 'send', threadId: id, text: 'try again' }],
    'the same process; main relaunches it without the fork',
  );
  const [restart] = resumeAfterLostProcess(
    thread(threadsReducer(s, again), id),
    { method: 'send', threadId: id, text: 'try again' },
  );
  assert.deepEqual(
    restart.method === 'start' && [
      restart.options.resume,
      restart.options.forkAt,
    ],
    ['sess-1', undefined],
  );
});

test('rewind chat and files: files are restored too, and a session main cannot cut starts fresh with the transcript', () => {
  const { s: s0, id, index } = liveThread();
  const s = threadsReducer(s0, {
    type: 'rewind-message',
    threadId: id,
    index,
    mode: 'files',
    forkAt: null,
  });
  assert.match(
    thread(s, id).activity.at(-1)!.text,
    /^Rewound files and transcript to before "Now write two"/,
  );
  assert.equal(s.rewindUndo!.hasFiles, true);
  const [start] = calls(s, {
    type: 'send',
    threadId: id,
    text: 'Now write 2',
    drift: 'on-goal',
    reason: '',
  });
  assert.ok(
    start.method === 'start' &&
      start.options.resume === undefined &&
      start.options.forkAt === undefined,
    'fresh session',
  );
  assert.match(
    start.method === 'start' ? start.options.prompt : '',
    /Assistant: Wrote one\.[\s\S]*Now write 2$/,
  );
  assert.ok(
    start.method === 'start' && !start.options.prompt.includes('Wrote two'),
    'nothing after the rewind point',
  );
});

test('undo brings back chat and files for either mode and resumes the original session', () => {
  for (const mode of ['chat', 'files'] as const) {
    const { s: s0, id, index } = liveThread();
    const before = thread(s0, id);
    let s = threadsReducer(s0, {
      type: 'rewind-message',
      threadId: id,
      index,
      mode,
      forkAt: 'uuid-after-one',
    });
    assert.equal(
      s.rewindUndo!.hasFiles,
      mode === 'files',
      'undo restores the files exactly when the rewind changed them',
    );
    // You sent again after the rewind, so an agent runs on the fork; undo stops it.
    s = threadsReducer(s, {
      type: 'send',
      threadId: id,
      text: 'Now write 2',
      drift: 'on-goal',
      reason: '',
    });
    s = applyAgentEvent(s, { threadId: id, type: 'turn-end', status: 'done' });
    assert.deepEqual(calls(s, { type: 'rewind-undo' }), [
      { method: 'stop', threadId: id },
    ]);
    s = threadsReducer(s, { type: 'rewind-undo' });
    const back = thread(s, id);
    assert.deepEqual(back.activity.slice(0, -1), before.activity, mode);
    assert.equal(back.activity.at(-1)!.text, 'Undid the rewind');
    const [start] = calls(s, {
      type: 'send',
      threadId: id,
      text: 'go on',
      drift: 'on-goal',
      reason: '',
    });
    assert.deepEqual(
      start.method === 'start' && [
        start.options.resume,
        start.options.forkAt,
        start.options.prompt,
      ],
      ['sess-1', undefined, 'go on'],
      'the original session, whole',
    );
  }
});
