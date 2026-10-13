import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialThreads } from '../store/threads.ts';
import { parseOutcome } from '../utility/prompts.ts';
import { goalDraftRequest, localGoalDraft } from './draft.ts';

test('parseOutcome reads a task with criteria, a chat, and rejects anything else', () => {
  assert.deepEqual(parseOutcome('```json\n{"kind":"task","outcome":"Dark mode toggle in settings.","criteria":["Toggle switches theme"," ","pnpm test passes","a","b"]}\n```'), {
    kind: 'task',
    outcome: 'Dark mode toggle in settings',
    criteria: ['Toggle switches theme', 'pnpm test passes', 'a', 'b'],
  });
  assert.deepEqual(parseOutcome('{"kind":"chat","outcome":"","criteria":[]}'), { kind: 'chat', outcome: '', criteria: [] });
  assert.equal(parseOutcome('{"kind":"task","outcome":""}'), null);
  assert.equal(parseOutcome('Sure! Here is the goal.'), null);
});

test('localGoalDraft keeps questions as chats and turns requests into the outcome', () => {
  assert.equal(localGoalDraft('How does the auth flow work?').kind, 'chat');
  assert.equal(localGoalDraft('explain the drift guard').kind, 'chat');
  assert.deepEqual(localGoalDraft('Add a dark mode toggle to settings.\nUse the existing tokens'), { kind: 'task', outcome: 'Add a dark mode toggle to settings', criteria: [] });
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
