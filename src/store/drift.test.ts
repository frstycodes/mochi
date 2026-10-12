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
