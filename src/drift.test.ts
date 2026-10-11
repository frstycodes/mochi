import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judgeDrift, judgeLocally, stepTitleFrom } from './drift.ts';
import { seedThreads } from './model.ts';

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
