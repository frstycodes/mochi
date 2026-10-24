import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { draftFrom } from '../goals/edit.ts';
import type { Action, State } from './index.tsx';
import { initialQueue } from './queue.ts';
import { initialThreads, threadsReducer } from './threads.ts';

const demoState = () => ({ ...initialThreads(null, true), ...initialQueue(null, true), spaceId: 'personal', views: {} }) as unknown as State;
const run = (s: State, action: Action) => threadsReducer(s, action);
const thread = (s: State, id: string) => s.threads.find((t) => t.id === id)!;

test('a message sent before its verdict goes out untagged, and the late verdict tags it without adding a step', () => {
  let s = run(demoState(), { type: 'create', title: 'add a readme', provider: 'claude', project: '/Users/me/dev/app', isLive: true });
  const id = s.threads.at(-1)!.id;
  s = run(s, { type: 'send', threadId: id, text: 'also add a license', reason: 'Checking against the goal' });
  const sent = thread(s, id).activity.at(-1)!;
  assert.equal(sent.text, 'also add a license');
  assert.equal(sent.drift, undefined, 'untagged while the classifier is out');
  assert.equal(thread(s, id).steps.length, 0);

  s = run(s, { type: 'send', threadId: id, text: 'keep going', drift: 'on-goal', reason: 'Short steering message' });
  s = run(s, { type: 'drift-verdict', threadId: id, text: 'also add a license', drift: 'scope-add', reason: 'Asks for something new' });
  const t = thread(s, id);
  assert.equal(t.activity.find((e) => e.text === 'also add a license')!.drift, 'scope-add', 'tags the earlier message, not the newest one');
  assert.deepEqual(t.steps, [], 'the agent plans it; Mochi adds nothing');
});

test('a late verdict for a message that is already tagged changes nothing', () => {
  let s = run(demoState(), { type: 'create', title: 'add a readme', provider: 'claude', project: '/Users/me/dev/app', isLive: true });
  const id = s.threads.at(-1)!.id;
  s = run(s, { type: 'send', threadId: id, text: 'fix the build', drift: 'on-goal', reason: 'Matches' });
  const before = thread(s, id);
  s = run(s, { type: 'drift-verdict', threadId: id, text: 'fix the build', drift: 'off-goal', reason: 'late' });
  assert.equal(thread(s, id), before);
});

test('a new thread has no goal until one is drafted; a draft never replaces a goal', () => {
  let s = run(demoState(), { type: 'create', title: 'hi', provider: 'claude', project: null, isLive: true });
  const id = s.threads.at(-1)!.id;
  assert.equal(thread(s, id).goal, '');
  assert.deepEqual(thread(s, id).revisions, []);
  s = run(s, { type: 'send', threadId: id, text: 'fix the login bug on the signup page', drift: 'on-goal', reason: 'No goal yet' });
  assert.equal(thread(s, id).goal, '', 'sending never sets the goal');
  s = run(s, { type: 'goal-drafted', threadId: id, outcome: 'Signup login bug fixed', criteria: [{ text: 'Signing up then logging in works' }, { text: 'pnpm test passes', command: 'pnpm test' }] });
  const t = thread(s, id);
  assert.deepEqual([t.goal, t.criteria!.map((c) => c.text), t.revisions.map((r) => [r.n, r.label, r.by])], ['Signup login bug fixed', ['Signing up then logging in works', 'pnpm test passes'], [[1, 'Goal drafted', 'harness']]]);
  assert.equal(t.title, 'hi', 'the title is not the goal');
  s = run(s, { type: 'goal-drafted', threadId: id, outcome: 'Something else', criteria: [] });
  assert.equal(thread(s, id).goal, 'Signup login bug fixed');
});

test('a removed goal stays off for drafts; an edit brings it back as a revision', () => {
  let s = run(demoState(), { type: 'create', title: 'add a readme', provider: 'claude', project: null, isLive: true });
  const id = s.threads.at(-1)!.id;
  s = run(s, { type: 'goal-drafted', threadId: id, outcome: 'README added', criteria: [] });
  s = run(s, { type: 'goal-remove', threadId: id });
  assert.deepEqual([thread(s, id).goal, thread(s, id).isGoalOff, thread(s, id).activity.at(-1)!.text], ['', true, 'Goal removed']);
  s = run(s, { type: 'goal-drafted', threadId: id, outcome: 'README added', criteria: [] });
  assert.equal(thread(s, id).goal, '');
  const draft = { ...draftFrom(thread(s, id)), goal: 'README with setup steps', criteria: [{ text: 'README lists install and run commands' }] };
  s = run(s, { type: 'edit-goal', threadId: id, draft });
  const t = thread(s, id);
  assert.deepEqual([t.goal, t.isGoalOff, t.revisions.at(-1)!.diff], ['README with setup steps', undefined, ['+ Goal: README with setup steps', '+ Done when: README lists install and run commands']]);
});

test('the second Keep here mutes the guard for that thread', () => {
  let s = run(demoState(), { type: 'create', title: 'add a readme', provider: 'claude', project: null, isLive: true });
  const id = s.threads.at(-1)!.id;
  s = run(s, { type: 'drift-keep', threadId: id });
  assert.deepEqual(thread(s, id).drift, { isMuted: false, keeps: 1 });
  s = run(s, { type: 'drift-keep', threadId: id });
  assert.deepEqual(thread(s, id).drift, { isMuted: true, keeps: 2 });
  assert.equal(thread(s, id).activity.at(-1)!.text, 'Drift guard off for this thread');
});
