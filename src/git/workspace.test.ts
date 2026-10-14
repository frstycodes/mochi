import assert from 'node:assert/strict';
import { test } from 'node:test';
import { branchName, branchText, uniqueBranch, withHead } from './workspace.ts';

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

test('the label names the branch, says "detached at" for a commit, and the head sets the mode the checkout really has', () => {
  const folder = { project: 'app', path: '/app', branch: 'feat/x', mode: 'folder' as const };
  assert.equal(branchText(folder), 'feat/x');
  const detached = withHead(folder, { branch: 'b64b993', isDetached: true }, false);
  assert.deepEqual(detached, { project: 'app', path: '/app', branch: 'b64b993', mode: 'folder', isDetached: true });
  assert.equal(branchText(detached), 'detached at b64b993');
  const named = withHead(detached, { branch: 'feat/theme', isDetached: false }, true);
  assert.deepEqual(named, { project: 'app', path: '/app', branch: 'feat/theme' }, 'its own worktree: worktree mode, no longer detached');
  assert.equal(branchText(named), 'feat/theme');
});
