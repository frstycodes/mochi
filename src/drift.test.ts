import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyWithModel, judgeDrift, judgeLocally, setDriftClassifier, stepTitleFrom } from './drift.ts';
import { seedThreads } from './model.ts';
import { setPrefs } from './settings/prefs.ts';

const rl = seedThreads().find((t) => t.id === 'rl')!;
const kind = (prompt: string) => (judgeDrift(prompt, rl) as { kind: string }).kind;

test('on-goal: matches an open step, or is a short steering message', () => {
  assert.equal(kind('Make the token bucket middleware refill every second'), 'on-goal');
  assert.equal(kind('ok go'), 'on-goal');
});

test('scope-add: a cue word plus overlap that no step covers goes to the classifier', () => {
  assert.equal(judgeLocally('Also return a Retry-After header on 429 responses', rl), null);
  assert.equal(kind('Also return a Retry-After header on 429 responses'), 'scope-add');
});

test('scope-add is not raised for work the plan already has', () => {
  assert.equal(kind('Also add the per-key overrides'), 'on-goal');
});

test('off-goal: nothing in common with the goal, steps or files', () => {
  assert.equal(kind('Fix the typo in the marketing landing page hero'), 'off-goal');
});

test('threshold is per thread', () => {
  const strict = { ...rl, drift: { threshold: 0.9, isMuted: false } };
  assert.equal(judgeLocally('Make the token bucket refill faster on the gateway', strict)?.kind, 'off-goal');
});

test('step titles drop the cue word', () => {
  assert.equal(stepTitleFrom('also add a Retry-After header.'), 'A Retry-After header');
});

test('classifyWithModel: the model settles ambiguous prompts, and any failure falls back to the local classifier', async () => {
  const prompt = 'Also return a Retry-After header on 429 responses';
  const local = await classifyWithModel(prompt, rl, () => Promise.reject(new Error('unused')));
  assert.equal(local.kind, 'scope-add');
  assert.deepEqual(await classifyWithModel(prompt, rl, async () => ({ verdict: 'off-goal', reason: 'Unrelated' })), { kind: 'off-goal', reason: 'Unrelated' });
  for (const model of [() => Promise.reject(new Error('logged out')), async () => ({ verdict: 'maybe', reason: 'x' }), async () => null, () => new Promise(() => {})]) {
    assert.deepEqual(await classifyWithModel(prompt, rl, model, 20), local);
  }
  let calls = 0;
  assert.equal((await classifyWithModel('ok go', rl, async () => (calls++, null))).kind, 'on-goal');
  assert.equal(calls, 0, 'clear cases never reach the model');
});

test('drift guard off (Settings or the thread) passes every message through without a classifier call', () => {
  let calls = 0;
  setDriftClassifier(() => (calls++, { kind: 'off-goal', reason: 'r' }));
  setPrefs({ driftGuard: false });
  assert.deepEqual(judgeDrift('Fix the typo in the marketing landing page hero', rl), { kind: 'on-goal', reason: 'Drift guard is off' });
  assert.equal(kind('Also return a Retry-After header on 429 responses'), 'on-goal');
  setPrefs({ driftGuard: true });
  assert.equal(kind('Also return a Retry-After header on 429 responses'), 'off-goal', 'back on, the ambiguous one reaches the classifier');
  assert.equal(calls, 1);
  assert.equal((judgeDrift('Fix the typo in the marketing landing page hero', { ...rl, drift: { threshold: 0.15, isMuted: true } }) as { kind: string }).kind, 'on-goal');
  assert.equal(calls, 1);
});
