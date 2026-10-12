import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Action, State } from './index.tsx';
import { initialQueue } from './queue.ts';
import { initialThreads, threadsReducer } from './threads.ts';

const demoState = () => ({ ...initialThreads(null, true), ...initialQueue(null, true), spaceId: 'personal', views: {} }) as unknown as State;
const run = (s: State, action: Action) => threadsReducer(s, action);
const thread = (s: State, id: string) => s.threads.find((t) => t.id === id)!;

test('a message sent before its verdict goes out untagged, and the late verdict tags it and adds the step', () => {
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
  assert.deepEqual(t.steps.map((st) => st.title), ['A license']);
});

test('a late verdict for a message that is already tagged changes nothing', () => {
  let s = run(demoState(), { type: 'create', title: 'add a readme', provider: 'claude', project: '/Users/me/dev/app', isLive: true });
  const id = s.threads.at(-1)!.id;
  s = run(s, { type: 'send', threadId: id, text: 'fix the build', drift: 'on-goal', reason: 'Matches' });
  const before = thread(s, id);
  s = run(s, { type: 'drift-verdict', threadId: id, text: 'fix the build', drift: 'off-goal', reason: 'late' });
  assert.equal(thread(s, id), before);
});

test('a thread started with a greeting takes its goal and title from the first concrete message', () => {
  let s = run(demoState(), { type: 'create', title: 'hi', provider: 'claude', project: null, isLive: true });
  const id = s.threads.at(-1)!.id;
  s = run(s, { type: 'send', threadId: id, text: 'thanks', drift: 'on-goal', reason: 'No goal yet' });
  assert.equal(thread(s, id).goal, 'hi');
  s = run(s, { type: 'send', threadId: id, text: 'fix the login bug on the signup page', drift: 'on-goal', reason: 'No goal yet' });
  assert.equal(thread(s, id).goal, 'fix the login bug on the signup page');
  assert.equal(thread(s, id).title, 'fix the login bug on the signup page');
  assert.equal(thread(s, id).revisions.at(-1)!.label, 'Goal set from your message');
  s = run(s, { type: 'send', threadId: id, text: 'and add a test for it', drift: 'on-goal', reason: 'r' });
  assert.equal(thread(s, id).goal, 'fix the login bug on the signup page', 'set once');
});

test('a renamed thread keeps its title when the goal is set', () => {
  let s = run(demoState(), { type: 'create', title: 'hey', provider: 'claude', project: null, isLive: true });
  const id = s.threads.at(-1)!.id;
  s = run(s, { type: 'rename', threadId: id, title: 'Auth work' });
  s = run(s, { type: 'send', threadId: id, text: 'migrate auth to Better Auth', drift: 'on-goal', reason: 'r' });
  assert.equal(thread(s, id).title, 'Auth work');
  assert.equal(thread(s, id).goal, 'migrate auth to Better Auth');
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
