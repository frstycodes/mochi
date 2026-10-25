import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { titleToSave } from './rename.ts';

test('a rename saves only a new, non-empty title', () => {
  assert.equal(titleToSave('Fix login', '  Fix signup  '), 'Fix signup');
  assert.equal(titleToSave('Fix login', 'Fix login '), undefined);
  assert.equal(titleToSave('Fix login', '   '), undefined);
});
