import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, mergeSettings } from '../host/types/settings.ts';
import { DEFAULT_ACCOUNTS } from './accounts.ts';
import { HARNESS_IDS, HARNESSES } from './harnesses.ts';

test('every harness gets defaults and a default account from the registry', () => {
  for (const id of HARNESS_IDS) {
    assert.deepEqual(DEFAULT_SETTINGS.harnesses[id], { path: '', model: HARNESSES[id].defaultModel });
    assert.ok(DEFAULT_ACCOUNTS.some((a) => a.provider === id && a.configDir === null));
  }
});

test('a patch merges per harness field and keeps everything else', () => {
  const next = mergeSettings(DEFAULT_SETTINGS, { harnesses: { claude: { path: '/opt/claude' } } });
  assert.deepEqual(next.harnesses.claude, { path: '/opt/claude', model: 'claude-opus-5-5' });
  assert.deepEqual(next.harnesses.codex, DEFAULT_SETTINGS.harnesses.codex);
  assert.equal(next.concurrency, 6);
  assert.equal(mergeSettings(next, { concurrency: 3 }).harnesses.claude.path, '/opt/claude');
});
