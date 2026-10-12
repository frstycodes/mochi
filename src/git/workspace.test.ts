import assert from 'node:assert/strict';
import { test } from 'node:test';
import { branchName, uniqueBranch } from './workspace.ts';

test('a new branch is the prefix plus the prompt as a slug, made unique against the branches that exist', () => {
  assert.equal(branchName('mochi/', 'Fix the login bug!', 'new-3'), 'mochi/fix-the-login-bug');
  assert.equal(branchName('mochi/', 'Café — résumé page, please do it now', 'new-3'), 'mochi/cafe-resume-page-please-do');
  assert.equal(branchName('mochi/', '???', 'new-3'), 'mochi/new-3');
  assert.equal(uniqueBranch('mochi/x', new Set(['mochi/x', 'mochi/x-2'])), 'mochi/x-3');
  assert.equal(uniqueBranch('mochi/y', new Set(['mochi/x'])), 'mochi/y');
});
