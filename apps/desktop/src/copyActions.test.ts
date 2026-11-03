import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { cloneSource, syncNeed } from './copyActions.ts';

test('a copy needs Push for commits of its own, Pull when only behind, nothing otherwise', () => {
  const at = (ahead: number, behind: number) => ({
    branch: 'main',
    changed: 0,
    upstream: { ahead, behind },
  });
  assert.equal(syncNeed(at(2, 0)), 'push');
  assert.equal(syncNeed(at(2, 3)), 'push');
  assert.equal(syncNeed(at(0, 3)), 'pull');
  assert.equal(syncNeed(at(0, 0)), null);
  assert.equal(syncNeed({ branch: 'wip', changed: 0 }), null);
  assert.equal(syncNeed(null), null);
});

test('a GitHub remote clones as owner/repo with gh, any other host over HTTPS', () => {
  assert.deepEqual(cloneSource('github.com/frstycodes/mochi'), {
    github: 'frstycodes/mochi',
  });
  assert.deepEqual(cloneSource('gitlab.com/me/repo'), {
    url: 'https://gitlab.com/me/repo.git',
  });
});
