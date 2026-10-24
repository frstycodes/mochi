import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { DRIFT_CASES, replay, score } from './drift.cases.ts';
import { classifyWithModel, isConcrete, judgeDrift, judgeLocally, localClassifier, setDriftClassifier, stepTitleFrom, type DriftClassifier } from './drift.ts';
import { seedThreads } from './model.ts';
import { setPrefs } from './settings/prefs.ts';

// Goals are retired and default off; their code is kept, so these tests turn them on to keep it honest.
setPrefs({ goals: true });

const rl = seedThreads().find((t) => t.id === 'rl')!;
const kind = (prompt: string) => (judgeDrift(prompt, rl) as { kind: string }).kind;

test('a goal needs a content word in a real sentence: greetings and pleasantries are not goals', () => {
  for (const text of ['hi', 'hello there', 'hey, how are you doing?', 'good morning', 'thanks!', 'ok', 'auth']) assert.equal(isConcrete(text), false, text);
  for (const text of ['fix auth', 'add a readme', 'hi, can you fix the login bug', 'what does this repo do?']) assert.equal(isConcrete(text), true, text);
});

test('the local pass only clears: matches, short messages, questions and steering are on-goal, nothing is off-goal', () => {
  assert.equal(kind('Make the token bucket middleware refill every second'), 'on-goal');
  assert.equal(kind('ok go'), 'on-goal');
  assert.equal(judgeLocally('why a token bucket?', rl)?.kind, 'on-goal');
  assert.equal(judgeLocally('use a sliding window instead', rl)?.kind, 'on-goal');
  assert.equal(judgeLocally('Fix the typo in the marketing landing page hero', rl), null, 'unclear goes to the classifier, never flagged locally');
});

test('scope-add: a cue word plus overlap that no step covers goes to the classifier', () => {
  assert.equal(judgeLocally('Also return a Retry-After header on 429 responses', rl), null);
  assert.equal(kind('Also return a Retry-After header on 429 responses'), 'scope-add');
});

test('step titles drop the cue word', () => {
  assert.equal(stepTitleFrom('also add a Retry-After header.'), 'A Retry-After header');
});

test('classifyWithModel: only a confident off-goal counts; any failure falls back to the local classifier', async () => {
  const prompt = 'Fix the typo in the marketing landing page hero';
  const local = await classifyWithModel(prompt, rl, () => Promise.reject(new Error('unused')));
  assert.equal(local.kind, 'on-goal', 'offline never interrupts');
  assert.deepEqual(await classifyWithModel(prompt, rl, async () => ({ verdict: 'off-goal', confidence: 'high', reason: 'Unrelated' })), { kind: 'off-goal', reason: 'Unrelated' });
  assert.equal((await classifyWithModel(prompt, rl, async () => ({ verdict: 'off-goal', confidence: 'low', reason: 'Maybe' }))).kind, 'on-goal');
  assert.equal((await classifyWithModel(prompt, rl, async () => ({ verdict: 'off-goal', reason: 'No confidence given' }))).kind, 'on-goal');
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
  setPrefs({ driftGuard: true });
  assert.equal(kind('Fix the typo in the marketing landing page hero'), 'off-goal', 'back on, the unclear one reaches the classifier');
  assert.equal(calls, 1);
  assert.equal((judgeDrift('Fix the typo in the marketing landing page hero', { ...rl, drift: { isMuted: true } }) as { kind: string }).kind, 'on-goal');
  assert.equal(calls, 1);
  setDriftClassifier(localClassifier);
});

/** Each case's flag, with `model` standing in for the classifier behind the local pass. */
async function flags(model: (c: (typeof DRIFT_CASES)[number]) => DriftClassifier) {
  const out: boolean[] = [];
  for (const c of DRIFT_CASES) {
    setDriftClassifier(model(c));
    out.push((await judgeDrift(c.prompt, replay(c))).kind === 'off-goal');
  }
  setDriftClassifier(localClassifier);
  return out;
}

// Real-model numbers come from `node scripts/drift-eval.ts`; these pin what the local pass and routing do.
test('labelled set: no false alarm, offline or with a model that flags everything it is asked', async () => {
  assert.deepEqual(score(await flags(() => localClassifier)), { tp: 0, fp: 0, fn: 8, precision: 1, recall: 0 });
  const legit = DRIFT_CASES.filter((c) => !c.isOffGoal).length;
  const paranoid = score(await flags(() => () => ({ kind: 'off-goal', reason: 'everything' })));
  assert.ok(paranoid.fp <= legit / 2, `the local pass clears most legit messages before the model sees them (${paranoid.fp} of ${legit} reached it)`);
});

test('labelled set: every side quest reaches the model, so a correct model catches all of them', async () => {
  const oracle = score(await flags((c) => () => ({ kind: c.isOffGoal ? 'off-goal' : 'on-goal', reason: 'oracle' })));
  assert.deepEqual(oracle, { tp: 8, fp: 0, fn: 0, precision: 1, recall: 1 });
});
