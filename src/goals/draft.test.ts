import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { State } from '../store/index.tsx';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { parseOutcome } from '../utility/prompts.ts';
import { goalDraftRequest, localGoalDraft } from './draft.ts';

test('parseOutcome reads a task with criteria, a chat, and rejects anything else', () => {
  assert.deepEqual(parseOutcome('```json\n{"kind":"task","outcome":"Dark mode toggle in settings.","criteria":["Toggle switches theme"," ","pnpm test passes","a","b"]}\n```'), {
    kind: 'task',
    outcome: 'Dark mode toggle in settings',
    criteria: ['Toggle switches theme', 'pnpm test passes', 'a', 'b'],
    similar: [],
  });
  assert.deepEqual(parseOutcome('{"kind":"chat","outcome":"","criteria":[]}'), { kind: 'chat', outcome: '', criteria: [], similar: [] });
  assert.deepEqual(parseOutcome('{"kind":"task","outcome":"x","criteria":[],"similar":[{"id":"rl","relation":"same"},{"id":"adm","relation":"maybe"},{"relation":"related"}]}')!.similar, [{ threadId: 'rl', relation: 'same' }]);
  assert.equal(parseOutcome('{"kind":"task","outcome":""}'), null);
  assert.equal(parseOutcome('Sure! Here is the goal.'), null);
});

test('localGoalDraft keeps questions as chats and turns requests into the outcome', () => {
  assert.equal(localGoalDraft('How does the auth flow work?').kind, 'chat');
  assert.equal(localGoalDraft('explain the drift guard').kind, 'chat');
  assert.deepEqual(localGoalDraft('Add a dark mode toggle to settings.\nUse the existing tokens'), { kind: 'task', outcome: 'Add a dark mode toggle to settings', criteria: [], similar: [] });
});

test('goalDraftRequest asks for your newest concrete message only while there is no goal', () => {
  const rl = initialThreads().threads.find((t) => t.id === 'rl')!;
  assert.equal(goalDraftRequest(rl), null, 'already has a goal');
  const fresh = { ...rl, goal: '', activity: [{ at: 1, who: 'you' as const, kind: 'message' as const, text: 'hi' }] };
  assert.equal(goalDraftRequest(fresh), null, 'small talk');
  const asked = { ...fresh, activity: [...fresh.activity, { at: 2, who: 'claude' as const, kind: 'message' as const, text: 'Hello!' }, { at: 3, who: 'you' as const, kind: 'message' as const, text: 'ok, refactor the auth module' }] };
  assert.match(goalDraftRequest(asked)!.prompt, /Earlier:\nUser: hi\nAgent: Hello!\n\nNewest message: ok, refactor the auth module$/);
  assert.equal(goalDraftRequest({ ...asked, isGoalOff: true }), null, 'you removed the goal');
});

test('goalDraftRequest shortlists overlapping goals in the same profile, settled ones too', () => {
  const { threads } = initialThreads();
  const rl = threads.find((t) => t.id === 'rl')!;
  const fresh = { ...rl, id: 'new', goal: '', activity: [{ at: 1, who: 'you' as const, kind: 'message' as const, text: 'rate limit public API keys by plan tier' }] };
  const elsewhere = { ...rl, id: 'other-space', spaceId: 'elsewhere' };
  const settled = { ...rl, id: 'old', status: 'settled' as const };
  const request = goalDraftRequest(fresh, [...threads, elsewhere, settled])!;
  assert.ok(request.others.includes('rl') && request.others.includes('old'));
  assert.ok(!request.others.includes('other-space'), 'another profile');
  assert.ok(request.related.some((r) => r.threadId === 'rl' && r.relation === 'related'), 'near-identical wording is related offline, never same');
  assert.match(request.prompt, /Other threads:\n\[rl\] Every public API key is rate limited/);
});

test('a drafted goal keeps its similar threads until you dismiss one', () => {
  const state = { ...initialThreads(), queue: [], spaceId: 'latitude', views: {} } as unknown as State;
  let s = threadsReducer(state, { type: 'create', title: 'rate limit keys', provider: 'claude', project: null, isLive: true });
  const id = s.threads.at(-1)!.id;
  s = threadsReducer(s, { type: 'goal-drafted', threadId: id, outcome: 'Keys rate limited', criteria: [], similar: [{ threadId: 'rl', relation: 'same' }] });
  assert.deepEqual(s.threads.at(-1)!.similar, [{ threadId: 'rl', relation: 'same' }]);
  s = threadsReducer(s, { type: 'similar-dismiss', threadId: id, otherId: 'rl' });
  assert.deepEqual(s.threads.at(-1)!.similar, []);
});
