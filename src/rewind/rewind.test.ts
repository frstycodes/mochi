import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { threadAt } from './checkpoints.ts';
import { forkRelatives } from './fork.ts';
import { handoffSummary } from './handoff.ts';

const base = () => ({ ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;
const thread = (s: State, id: string) => s.threads.find((t) => t.id === id)!;
const tickUntil = (s: State, done: (s: State) => boolean) => {
  for (let i = 0; i < 500 && !done(s); i++) s = threadsReducer(s, { type: 'tick' });
  return s;
};

test('threadAt rebuilds steps, activity and revisions as they stood', () => {
  const rl = thread(base(), 'rl');
  const past = threadAt(rl, rl.startedAt + 30);
  assert.deepEqual(past.steps.map((s) => s.status).slice(0, 2), ['done', 'running']);
  assert.ok(!past.steps.some((s) => s.id === 'rl7'), 'step added at v2 is not there yet');
  assert.ok(past.activity.every((a) => a.at <= rl.startedAt + 30));
  assert.equal(past.revisions.length, 1);
  assert.equal(past.status, 'running');
});

test('seeded threads get a start checkpoint plus one per finished step', () => {
  const s = base();
  assert.deepEqual(s.checkpoints.rl.map((c) => c.label), ['Start', 'After "Agree limit tiers per plan"', 'After "Design limits schema"', 'After "Wire limits into gateway config"']);
  const ns = Object.values(s.checkpoints).flat().map((c) => c.n);
  assert.equal(new Set(ns).size, ns.length, 'checkpoint numbers are unique');
});

test('a finished step records a checkpoint that asks for files', () => {
  const s0 = base();
  const s = tickUntil(s0, (s) => thread(s, 'rl').steps.find((x) => x.id === 'rl5')!.status === 'done');
  const last = s.checkpoints.rl.at(-1)!;
  assert.equal(last.stepId, 'rl5');
  assert.equal(last.wantsFiles, true);
  assert.equal(last.thread.steps.find((x) => x.id === 'rl5')!.status, 'done');
});

test('rewind restores the snapshot, drops later checkpoints, and one undo brings it all back', () => {
  let s = tickUntil(base(), (s) => thread(s, 'rl').steps.find((x) => x.id === 'rl5')!.status === 'done');
  const before = thread(s, 'rl');
  const target = s.checkpoints.rl[1];
  s = threadsReducer(s, { type: 'rewind', threadId: 'rl', n: target.n });
  const rewound = thread(s, 'rl');
  assert.equal(rewound.steps.filter((x) => x.status === 'done').length, 1);
  assert.equal(rewound.activity.at(-1)!.text, 'Rewound transcript to after "Agree limit tiers per plan"');
  assert.equal(rewound.revisions.at(-1)!.label, 'Rewound to after "Agree limit tiers per plan"');
  assert.ok(rewound.steps.filter((x) => x.status === 'running').every((x) => x.startedAt === s.now), 'running steps restart their clock');
  assert.equal(s.checkpoints.rl.at(-1)!.n, target.n);
  s = threadsReducer(s, { type: 'rewind-undo' });
  const back = thread(s, 'rl');
  assert.deepEqual(back.steps, before.steps);
  assert.equal(back.activity.length, before.activity.length + 1);
  assert.equal(s.rewindUndo, null);
  assert.equal(threadsReducer(s, { type: 'rewind-undo' }), s, 'only one undo');
});

test('fork copies context up to a message, opens a new branch, and records where it came from', () => {
  let s = base();
  const parent = thread(s, 'adm');
  const index = 4;
  s = threadsReducer(s, { type: 'fork', threadId: 'adm', point: { kind: 'message', index } });
  const child = s.threads.find((t) => t.id.startsWith('fork-'))!;
  assert.equal(s.forks[child.id].parentId, 'adm');
  assert.equal(child.activity.length, index + 2, 'messages up to the fork point plus the fork event');
  assert.equal(child.repo!.branch, `${parent.repo!.branch}-fork-1`);
  assert.notEqual(child.line, parent.line);
  assert.ok(child.steps.every((st) => !parent.steps.some((p) => p.id === st.id)), 'step ids are the fork’s own');
  assert.match(thread(s, 'adm').activity.at(-1)!.text, /^Forked to/);
  assert.deepEqual(s.views.latitude, { kind: 'thread', id: child.id });
  assert.deepEqual(s.checkpoints[child.id].map((c) => c.label), ['Fork point']);
  assert.deepEqual(forkRelatives(s, 'adm').map((t) => t.id), [child.id]);
  assert.deepEqual(forkRelatives(s, child.id).map((t) => t.id), ['adm']);

  s = threadsReducer(s, { type: 'fork-keep', keepId: child.id, dropId: 'adm' });
  assert.equal(thread(s, 'adm').status, 'settled');
  assert.equal(forkRelatives(s, child.id).length, 0);
});

test('fork from a checkpoint names it for the worktree only once its files were saved', () => {
  let s = base();
  const cp = s.checkpoints.adm[1];
  s = threadsReducer(s, { type: 'fork', threadId: 'adm', point: { kind: 'checkpoint', n: cp.n } });
  assert.equal(Object.values(s.forks)[0].checkpoint, undefined);
  s = threadsReducer(base(), { type: 'checkpoint-ref', threadId: 'adm', n: cp.n, ref: 'abc' });
  s = threadsReducer(s, { type: 'fork', threadId: 'adm', point: { kind: 'checkpoint', n: cp.n } });
  assert.equal(Object.values(s.forks)[0].checkpoint, cp.n);
});

test('handoff moves one step or the whole thread and logs an event and the summary, not a revision', () => {
  let s = base();
  const rl = thread(s, 'rl');
  const summary = handoffSummary(rl, 'codex', undefined, { files: 3, added: 40, removed: 6 });
  assert.match(summary, /Goal:\*\* Every public API key/);
  assert.match(summary, /Add Redis client \(running, 12%\)/);
  assert.match(summary, /3 files, \+40 −6/);

  s = threadsReducer(s, { type: 'handoff', threadId: 'rl', stepId: 'rl6', to: 'codex', summary });
  let t = thread(s, 'rl');
  assert.equal(t.steps.find((x) => x.id === 'rl6')!.owner, 'codex');
  assert.deepEqual(t.providers, ['claude', 'codex']);
  assert.equal(t.revisions.length, rl.revisions.length, 'what done means is unchanged');
  assert.equal(t.activity.at(-2)!.text, 'Handed "Token bucket middleware" from Claude to Codex with a context summary');
  assert.equal(t.activity.at(-1)!.text, summary);

  s = threadsReducer(s, { type: 'handoff', threadId: 'rl', to: 'codex', summary });
  t = thread(s, 'rl');
  assert.deepEqual(t.providers, ['codex', 'claude']);
  assert.equal(t.steps.find((x) => x.id === 'rl1')!.owner, 'claude', 'finished steps keep who did them');
  assert.equal(t.steps.find((x) => x.id === 'rl6')!.owner, undefined, 'open steps follow the thread');
});

test('rewinding to a message drops it and everything after, keeps what came before, and undoes in one step', () => {
  let s = base();
  const before = thread(s, 'rl');
  const index = before.activity.findIndex((a) => a.who === 'you' && a.text.startsWith('Also add per-key overrides'));
  s = threadsReducer(s, { type: 'rewind-message', threadId: 'rl', index });
  const rewound = thread(s, 'rl');
  const kept = rewound.activity.slice(0, -1);
  assert.deepEqual(kept, before.activity.slice(0, index), 'transcript stops right before the message');
  assert.match(rewound.activity.at(-1)!.text, /^Rewound transcript to before "Also add per-key overrides/);
  assert.ok(!rewound.steps.some((x) => x.id === 'rl7'), 'the step that message added is gone');
  s = threadsReducer(s, { type: 'rewind-undo' });
  assert.deepEqual(thread(s, 'rl').steps, before.steps);
});
