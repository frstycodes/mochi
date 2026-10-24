import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Thread } from '../model.ts';
import type { Action, State } from './index.tsx';
import { threadsReducer } from './threads.ts';

const thread = (id: string, patch: Partial<Thread> = {}) => ({ id, spaceId: 's', title: id, status: 'running', providers: ['claude'], steps: [], activity: [], prs: [], startedAt: 0, criteria: [], ...patch }) as unknown as Thread;
const start = (threads: Thread[]) => ({ now: 9, threads, queue: [], checkpoints: Object.fromEntries(threads.map((t) => [t.id, []])), checkpointSeq: 0, forks: {} }) as unknown as State;
const run = (state: State, ...actions: Action[]) => actions.reduce(threadsReducer, state);
const byId = (state: State, id: string) => state.threads.find((t) => t.id === id)!;

test('nesting unpins the sub-thread, goes a second level deep, and refuses a cycle', () => {
  const s = run(start([thread('p'), thread('c', { orbitSlot: 1 }), thread('x')]), { type: 'nest', threadId: 'c', parentId: 'p' }, { type: 'nest', threadId: 'x', parentId: 'c' });
  assert.deepEqual(byId(s, 'c').parent, { threadId: 'p' });
  assert.equal(byId(s, 'c').orbitSlot, undefined);
  assert.deepEqual(byId(s, 'x').parent, { threadId: 'c' });
  assert.deepEqual(byId(run(s, { type: 'nest', threadId: 'p', parentId: 'x' }), 'p').parent, undefined, 'p under its own grandchild: refused');
  assert.equal(byId(run(s, { type: 'unnest', threadId: 'c' }), 'c').parent, undefined);
});

test('handing back claims the covered criterion once and leaves a result row in the parent', () => {
  const parent = thread('p', { criteria: [{ id: 'load', text: 'Holds 2k req/s' }] });
  const child = thread('c', { title: 'Load test', parent: { threadId: 'p', criterionId: 'load' } });
  const s = run(start([parent, child]), { type: 'subthread-handback', threadId: 'c', evidence: 'p99 41ms at 2k req/s, PR #142' }, { type: 'subthread-handback', threadId: 'c', evidence: 'again' });
  assert.equal(byId(s, 'c').parent?.handedBackAt, 9);
  assert.equal(byId(s, 'p').criteria![0].claim?.evidence, 'p99 41ms at 2k req/s, PR #142');
  assert.deepEqual(byId(s, 'p').activity.filter((e) => e.subThread).map((e) => e.subThread!.text), ['p99 41ms at 2k req/s, PR #142']);
});

test('settling a parent settles its open sub-threads; deleting it frees them', () => {
  const threads = [thread('p'), thread('c', { parent: { threadId: 'p' } }), thread('x')];
  const settled = run(start(threads), { type: 'settle', threadId: 'p' });
  assert.deepEqual(settled.threads.map((t) => t.status), ['settled', 'settled', 'running']);
  const deleted = run(start(threads), { type: 'delete', threadIds: ['p'] });
  assert.equal(byId(deleted, 'c').parent, undefined);
});

test("settling cascades down a two-level tree, stopping at a settled sub-thread whose subtree already stands alone", () => {
  const threads = [
    thread('p'),
    thread('c', { parent: { threadId: 'p' } }),
    thread('g', { parent: { threadId: 'c' } }),
    thread('done', { status: 'settled', settledAt: 1, parent: { threadId: 'p' } }),
    thread('loose', { parent: { threadId: 'done' } }),
  ];
  const s = run(start(threads), { type: 'settle', threadId: 'p' });
  assert.deepEqual(s.threads.map((t) => [t.id, t.status]), [['p', 'settled'], ['c', 'settled'], ['g', 'settled'], ['done', 'settled'], ['loose', 'running']]);
  assert.equal(byId(s, 'done').settledAt, 1, 'an already settled one keeps its time');
});
