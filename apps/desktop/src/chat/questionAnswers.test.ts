import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  clearAt,
  finalAnswers,
  isAnswered,
  pick,
  stepAfter,
} from './questionAnswers.ts';

test('a single choice replaces, a multiple choice toggles', () => {
  assert.deepEqual(pick([['Redis']], 0, 'Postgres', false), [['Postgres']]);
  const ticked = pick([['Typecheck']], 0, 'Lint', true);
  assert.deepEqual(ticked, [['Typecheck', 'Lint']]);
  assert.deepEqual(pick(ticked, 0, 'Typecheck', true), [['Lint']]);
});

test('typed text counts as an answer; whitespace does not', () => {
  assert.equal(isAnswered([[]], ['use SQLite'], 0), true);
  assert.equal(isAnswered([[]], ['   '], 0), false);
});

test('Next and Skip move on, and the last one sends', () => {
  assert.equal(stepAfter(0, 3), 1);
  assert.equal(stepAfter(2, 3), 'send');
});

test('a skipped question sends nothing, the others send picks plus typed text', () => {
  const answers = clearAt([['Redis'], ['Lint']], 1, [] as string[]);
  const other = clearAt(['', 'and e2e'], 1, '');
  assert.deepEqual(finalAnswers(answers, other), [['Redis'], []]);
  assert.deepEqual(finalAnswers([['Lint']], [' e2e ']), [['Lint', 'e2e']]);
});
