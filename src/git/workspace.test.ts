import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { branchFromTitle, branchText, tempBranch, withHead } from './workspace.ts';

test('a new branch starts on prefix + 8 hex, the same for the same seed, and takes its title as a slug, made unique', () => {
  const temp = tempBranch('mochi/', 'latitude/new-3/120');
  assert.match(temp, /^mochi\/[0-9a-f]{8}$/);
  assert.equal(tempBranch('mochi/', 'latitude/new-3/120'), temp, 'pure: the reducer and the composer agree');
  assert.notEqual(tempBranch('mochi/', 'latitude/new-4/120'), temp);
  assert.match(tempBranch('', 'x'), /^[0-9a-f]{8}$/);

  assert.equal(branchFromTitle(temp, 'Fix login redirect', new Set()), 'mochi/fix-login-redirect');
  assert.equal(branchFromTitle(temp, 'Café — résumé page', new Set()), 'mochi/cafe-resume-page');
  assert.equal(branchFromTitle('me/0badf00d', 'Dark mode toggle', new Set()), 'me/dark-mode-toggle');
  assert.equal(branchFromTitle(temp, 'Fix login', new Set(['mochi/fix-login', 'mochi/fix-login-2'])), 'mochi/fix-login-3');
  assert.equal(branchFromTitle(temp, '???', new Set()), null, 'no slug');
  assert.equal(branchFromTitle('feat/my-branch', 'Fix login', new Set()), null, 'not a temp name');
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
