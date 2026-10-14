import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { titleRequest } from './titles.ts';

const demoState = () => ({ ...initialThreads(null, true), ...initialQueue(null, true), spaceId: 'personal', views: {} }) as unknown as State;
const run = (s: State, action: Action) => threadsReducer(s, action);

test('a live thread is named once after its first exchange, and never over a title you renamed', () => {
  let s = run(demoState(), { type: 'create', title: 'fix the login redirect so it keeps the next parameter after sign in', provider: 'claude', project: '/Users/me/dev/app', isLive: true });
  const id = s.threads.at(-1)!.id;
  const t = () => s.threads.find((x) => x.id === id)!;
  const answered = (isWorking: boolean) => ({ ...t(), live: { ...t().live!, isWorking }, activity: [...t().activity, { at: 1, who: 'claude' as const, kind: 'message' as const, text: 'Fixed: the callback keeps ?next.' }] });

  assert.equal(titleRequest(t()), null, 'no agent reply yet');
  assert.equal(titleRequest(answered(true)), null, 'still working');
  assert.match(titleRequest(answered(false))!, /^User: fix the login redirect[\s\S]*Agent: Fixed: the callback keeps \?next\.$/);

  s = run(s, { type: 'title-generated', threadId: id, title: 'Login redirect keeps next' });
  assert.equal(t().title, 'Login redirect keeps next');
  assert.equal(titleRequest(answered(false)), null, 'named once');

  s = run(s, { type: 'rename', threadId: id, title: 'Auth bug' });
  s = run(s, { type: 'title-generated', threadId: id, title: 'Something else' });
  assert.equal(t().title, 'Auth bug', 'your name stays');
});

test('a thread started with "hi" waits for a real goal before it is named', () => {
  let s = run(demoState(), { type: 'create', title: 'hi', provider: 'claude', project: null, isLive: true });
  const t = s.threads.at(-1)!;
  assert.equal(titleRequest({ ...t, live: { isWorking: false }, activity: [...t.activity, { at: 1, who: 'claude', kind: 'message', text: 'Hello! What are we building?' }] }), null);
});
