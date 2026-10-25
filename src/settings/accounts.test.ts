import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Account } from '../host/types/settings.ts';
import { DEFAULT_ACCOUNTS, linkedAccountId, newAccountId, profilesUsing, signInCommand } from './accounts.ts';

const work: Account = { id: 'claude-work', provider: 'claude', name: 'Work', configDir: '/Users/me/.harness/accounts/claude-work' };

test('profiles fall back to the default account per provider', () => {
  const links = { latitude: { claude: 'claude-work' } };
  assert.equal(linkedAccountId(links, 'latitude', 'claude'), 'claude-work');
  assert.equal(linkedAccountId(links, 'latitude', 'codex'), 'codex-default');
  assert.equal(linkedAccountId(links, 'personal', 'claude'), 'claude-default');
  assert.deepEqual(profilesUsing(links, ['latitude', 'personal', 'liane'], work), ['latitude']);
  assert.deepEqual(profilesUsing(links, ['latitude', 'personal', 'liane'], DEFAULT_ACCOUNTS[0]), ['personal', 'liane']);
});

test('sign-in commands point the tool at the account folder', () => {
  assert.equal(signInCommand(DEFAULT_ACCOUNTS[0], false), 'claude auth login');
  assert.equal(signInCommand(DEFAULT_ACCOUNTS[1], false), 'codex login');
  assert.equal(signInCommand(work, false), 'CLAUDE_CONFIG_DIR=/Users/me/.harness/accounts/claude-work claude auth login');
  assert.equal(signInCommand({ ...work, provider: 'codex', configDir: "/Users/o'brien/my accounts" }, false), `CODEX_HOME='/Users/o'\\''brien/my accounts' codex login`);
  assert.equal(signInCommand({ ...work, configDir: "C:\\Users\\o'brien\\acct" }, true), "$env:CLAUDE_CONFIG_DIR='C:\\Users\\o''brien\\acct'; claude auth login");
});

test('account ids are readable and unique', () => {
  assert.equal(newAccountId('claude', 'Work (Team)', []), 'claude-work-team');
  assert.equal(newAccountId('codex', 'Work', ['codex-work']), 'codex-work-2');
  assert.equal(newAccountId('codex', '!!!', []), 'codex-account');
});
