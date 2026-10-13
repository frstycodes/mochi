import assert from 'node:assert/strict';
import { test } from 'node:test';
import { branchName, uniqueBranch } from './workspace.ts';

test('a new branch is the prefix plus the prompt as a slug, made unique against the branches that exist', () => {
  assert.equal(branchName('', 'Fix the login bug!', 'new-3'), 'fix/login-bug');
  assert.equal(branchName('', 'Add a dark mode toggle to settings', 'new-3'), 'feat/dark-mode-toggle-settings');
  assert.equal(branchName('', 'please refactor the auth module', 'new-3'), 'refactor/auth-module');
  assert.equal(branchName('', 'Café — résumé page, please do it now', 'new-3'), 'feat/cafe-resume-page-do-it');
  assert.equal(branchName('sandesh/', 'update the README', 'new-3'), 'sandesh/feat/update-readme');
  assert.equal(branchName('', '???', 'new-3'), 'new-3');
  assert.equal(uniqueBranch('mochi/x', new Set(['mochi/x', 'mochi/x-2'])), 'mochi/x-3');
  assert.equal(uniqueBranch('mochi/y', new Set(['mochi/x'])), 'mochi/y');
});
