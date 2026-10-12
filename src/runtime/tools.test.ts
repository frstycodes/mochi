import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { runTool } from './tools.ts';

const base = () => ({ ...initialThreads(undefined, true), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;
const call = (name: string, args: Record<string, unknown> = {}, threadId = 'rl') => ({ id: 't1', threadId, name, args });
const run = (s: State, name: string, args?: Record<string, unknown>, threadId?: string) => runTool(s, call(name, args, threadId), threadsReducer);
const json = (r: ReturnType<typeof run>) => JSON.parse(r.result.text);

test('get_goal returns the calling thread goal with step ids, and another thread in the same profile by id', () => {
  const s = base();
  const own = json(run(s, 'get_goal'));
  assert.equal(own.threadId, 'rl');
  assert.deepEqual(own.steps.map((x: { id: string }) => x.id), s.threads.find((t) => t.id === 'rl')!.steps.map((x) => x.id));
  assert.equal(json(run(s, 'get_goal', { threadId: 'adm' })).threadId, 'adm');
  const other = s.threads.find((t) => t.spaceId !== 'latitude')!;
  assert.equal(run(s, 'get_goal', { threadId: other.id }).result.isError, true, 'another profile is out of reach');
});

test('set_step_status completes through completeStep and logs other statuses as the agent', () => {
  const s = base();
  const step = s.threads.find((t) => t.id === 'rl')!.steps.find((x) => x.status !== 'done')!;
  const done = run(s, 'set_step_status', { stepId: step.id, status: 'done' });
  assert.deepEqual(done.action, { type: 'step-status', threadId: 'rl', stepId: step.id, status: 'done', by: 'claude' });
  const after = done.next.threads.find((t) => t.id === 'rl')!;
  assert.equal(after.steps.find((x) => x.id === step.id)!.doneAt, s.now);
  assert.equal(after.activity.at(-1)!.text, `Finished "${step.title}"`);
  const blocked = run(s, 'set_step_status', { stepId: step.id, status: 'blocked' }).next.threads.find((t) => t.id === 'rl')!;
  assert.equal(blocked.steps.find((x) => x.id === step.id)!.status, 'blocked');
  assert.equal(run(s, 'set_step_status', { stepId: step.id, status: 'nope' }).result.isError, true);
  assert.equal(run(s, 'set_step_status', { stepId: 'missing', status: 'done' }).result.isError, true);
});

test('add_step lands as a goal revision by the agent', () => {
  const s = base();
  const before = s.threads.find((t) => t.id === 'rl')!;
  const r = run(s, 'add_step', { title: 'Document the limits', size: 2 });
  const after = r.next.threads.find((t) => t.id === 'rl')!;
  const added = after.steps.find((x) => x.title === 'Document the limits')!;
  assert.deepEqual([added.size, added.status, added.addedBy], [2, 'ready', 'claude']);
  assert.equal(after.revisions.length, before.revisions.length + 1);
  assert.equal(after.revisions.at(-1)!.by, 'claude');
  assert.ok(json(r).steps.some((x: { id: string }) => x.id === added.id), 'the result carries the new step id');
  assert.equal(run(s, 'add_step', { title: '  ' }).result.isError, true);
});

test('list_threads lists only the calling thread profile', () => {
  const s = base();
  const listed = json(run(s, 'list_threads'));
  assert.deepEqual(listed.map((t: { id: string }) => t.id), s.threads.filter((t) => t.spaceId === 'latitude').map((t) => t.id));
  assert.ok(listed.every((t: { provider: string }) => t.provider === 'claude' || t.provider === 'codex'));
});

test('create_thread creates in the same project without moving your view, and returns the new thread', () => {
  const s = base();
  const caller = s.threads.find((t) => t.id === 'rl')!;
  const r = run(s, 'create_thread', { prompt: 'Add a rate limit dashboard', provider: 'codex' });
  const created = json(r);
  const thread = r.next.threads.find((t) => t.id === created.id)!;
  assert.equal(thread.goal, 'Add a rate limit dashboard');
  assert.deepEqual(thread.providers, ['codex']);
  assert.equal(thread.repo?.project, caller.repo?.project);
  assert.deepEqual(r.next.views, s.views);
  assert.equal(run(s, 'create_thread', { prompt: '' }).result.isError, true);
});

test('an unknown tool or caller is an error, not a throw', () => {
  const s = base();
  assert.equal(run(s, 'rm_rf').result.isError, true);
  assert.equal(run(s, 'get_goal', {}, 'ghost').result.isError, true);
});
