import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { cloneSource } from './copyActions.ts';

test('a GitHub remote clones as owner/repo with gh, any other host over HTTPS', () => {
  assert.deepEqual(cloneSource('github.com/frstycodes/mochi'), {
    github: 'frstycodes/mochi',
  });
  assert.deepEqual(cloneSource('gitlab.com/me/repo'), {
    url: 'https://gitlab.com/me/repo.git',
  });
});
