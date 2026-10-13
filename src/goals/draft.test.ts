import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { State } from '../store/index.tsx';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { isMet } from '../model.ts';
import { parseOutcome } from '../utility/prompts.ts';
import { goalDraftRequest, localGoalDraft } from './draft.ts';
import { draftFrom } from './edit.ts';
import { currentReport, reportHeadline } from './report.ts';

test('parseOutcome reads a task with criteria, a chat, and rejects anything else', () => {
  assert.deepEqual(parseOutcome('```json\n{"kind":"task","outcome":"Dark mode toggle in settings.","criteria":["Toggle switches theme"," ","pnpm test passes","a","b"]}\n```'), {
    kind: 'task',
    outcome: 'Dark mode toggle in settings',
    criteria: [{ text: 'Toggle switches theme' }, { text: 'pnpm test passes' }, { text: 'a' }, { text: 'b' }],
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

test('a report counts until you write again; rewording a criterion drops its claim', () => {
  const state = { ...initialThreads(), queue: [], spaceId: 'latitude', views: {} } as unknown as State;
  let s = threadsReducer(state, { type: 'create', title: 'add retry-after', provider: 'claude', project: null, isLive: true });
  const id = s.threads.at(-1)!.id;
  s = threadsReducer(s, { type: 'goal-drafted', threadId: id, outcome: '429s carry Retry-After', criteria: [{ text: 'Header present' }, { text: 'Tests pass' }] });
  const [first] = s.threads.at(-1)!.criteria!;
  s = threadsReducer(s, { type: 'criterion-claim', threadId: id, criterionId: first.id, evidence: 'curl shows it', by: 'claude' });
  s = threadsReducer(s, { type: 'report', threadId: id, report: { by: 'claude', decisions: [], left: ['Tests'] } });
  const idle = (t: (typeof s.threads)[number]) => ({ ...t, live: { ...t.live!, isWorking: false } });
  assert.equal(reportHeadline(idle(s.threads.at(-1)!)), '1 of 2 criteria done');
  s = threadsReducer({ ...s, now: s.now + 1 }, { type: 'send', threadId: id, text: 'also log it', reason: '' });
  assert.equal(currentReport(idle(s.threads.at(-1)!)), null, 'your newer message starts a turn the report no longer describes');
  const draft = draftFrom(s.threads.at(-1)!);
  draft.criteria[0].text = 'Header present on every 429';
  s = threadsReducer(s, { type: 'edit-goal', threadId: id, draft });
  assert.equal(s.threads.at(-1)!.criteria![0].claim, undefined);
});

test('a failed check outweighs a claim; a passed one meets the criterion; changing the command resets it', () => {
  assert.deepEqual(parseOutcome('{"kind":"task","outcome":"x","criteria":[{"text":"Tests pass","command":" pnpm test "},{"text":"Docs"},"Plain",{"command":"orphan"}]}')!.criteria, [{ text: 'Tests pass', command: 'pnpm test' }, { text: 'Docs' }, { text: 'Plain' }]);
  const state = { ...initialThreads(), queue: [], spaceId: 'latitude', views: {} } as unknown as State;
  let s = threadsReducer(state, { type: 'create', title: 'fix the tests', provider: 'claude', project: null, isLive: true });
  const id = s.threads.at(-1)!.id;
  s = threadsReducer(s, { type: 'goal-drafted', threadId: id, outcome: 'Tests green', criteria: [{ text: 'Tests pass', command: 'pnpm test' }] });
  const [c] = s.threads.at(-1)!.criteria!;
  s = threadsReducer(s, { type: 'criterion-claim', threadId: id, criterionId: c.id, evidence: 'ran it', by: 'claude' });
  s = threadsReducer(s, { type: 'criterion-check', threadId: id, criterionId: c.id, result: { exitCode: 1, output: '1 failing', ms: 900 } });
  assert.equal(isMet(s.threads.at(-1)!.criteria![0]), false);
  assert.equal(s.threads.at(-1)!.activity.at(-1)!.text, 'Check failed: Tests pass');
  s = threadsReducer(s, { type: 'criterion-check', threadId: id, criterionId: c.id, result: { exitCode: 0, output: 'ok', ms: 900 } });
  assert.equal(isMet(s.threads.at(-1)!.criteria![0]), true);
  const draft = draftFrom(s.threads.at(-1)!);
  draft.criteria[0].command = 'pnpm vitest run';
  s = threadsReducer(s, { type: 'edit-goal', threadId: id, draft });
  assert.deepEqual(s.threads.at(-1)!.criteria![0], { id: c.id, text: 'Tests pass', command: 'pnpm vitest run' });
});
