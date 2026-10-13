import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextStep } from './report.ts';

test('a met goal waits on opening a PR, then on its review, then on settling once merged', () => {
  assert.equal(nextStep([]), 'open-pr');
  assert.equal(nextStep(['closed']), 'open-pr');
  assert.equal(nextStep(['draft']), 'review');
  assert.equal(nextStep(['merged', 'open']), 'review');
  assert.equal(nextStep(['merged', 'closed']), 'settle');
});
