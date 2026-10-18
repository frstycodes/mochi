import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNewerVersion, parseClaudeAuth, parseCodexAccount, parseVersion } from './parse.ts';

// CLAUDE_LOGGED_OUT and CODEX_PLUS are real output (Claude Code 2.1.296, codex-cli 0.155.1), emails replaced.
// GAP: the logged-in Claude fixtures are built from the field names in Claude Code 2.1.296's `auth status` source, not captured runs.
const CLAUDE_LOGGED_OUT = `{
  "loggedIn": false,
  "authMethod": "none",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "/Users/me/.claude/projects",
  "configDirectory": "/Users/me/.claude"
}`;
const CLAUDE_MAX = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'me@example.com', orgName: 'Org', subscriptionType: 'max' });
const CLAUDE_API_KEY = JSON.stringify({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY' });
const CLAUDE_BEDROCK = JSON.stringify({ loggedIn: true, authMethod: 'third_party', apiProvider: 'bedrock' });
const CODEX_PLUS = { account: { type: 'chatgpt', email: 'me@example.com', planType: 'plus' }, requiresOpenaiAuth: true };

test('versions from both CLIs', () => {
  assert.equal(parseVersion('2.1.296 (Claude Code)\n'), '2.1.296');
  assert.equal(parseVersion('codex-cli 0.155.1\n'), '0.155.1');
  assert.equal(parseVersion('codex-cli 0.156.0-alpha.2'), '0.156.0-alpha.2');
  assert.equal(parseVersion('command not found'), null);
});

test('published versions only trigger updates when newer', () => {
  assert.equal(isNewerVersion('0.159.1', '0.155.1'), true);
  assert.equal(isNewerVersion('2.1.302', '2.1.302'), false);
  assert.equal(isNewerVersion('2.1.301', '2.1.302'), false);
  assert.equal(isNewerVersion('0.156.0', '0.156.0-alpha.2'), true);
  assert.equal(isNewerVersion(null, '0.155.1'), false);
});

test('claude auth status', () => {
  assert.deepEqual(parseClaudeAuth(CLAUDE_LOGGED_OUT), { state: 'logged-out' });
  assert.deepEqual(parseClaudeAuth(CLAUDE_MAX), { state: 'logged-in', method: 'Claude account', plan: 'Max' });
  assert.deepEqual(parseClaudeAuth(CLAUDE_API_KEY), { state: 'logged-in', method: 'API key', plan: undefined });
  assert.deepEqual(parseClaudeAuth(CLAUDE_BEDROCK), { state: 'logged-in', method: 'Cloud provider (bedrock)', plan: undefined });
  assert.equal(parseClaudeAuth('Not logged in. Run claude auth login to authenticate.').state, 'unknown');
});

test('claude status never carries the email or org', () => {
  assert.doesNotMatch(JSON.stringify(parseClaudeAuth(CLAUDE_MAX)), /example\.com|Org/);
});

test('codex account/read', () => {
  assert.deepEqual(parseCodexAccount(CODEX_PLUS), { state: 'logged-in', method: 'ChatGPT', plan: 'Plus' });
  assert.deepEqual(parseCodexAccount({ account: { type: 'apiKey' }, requiresOpenaiAuth: true }), { state: 'logged-in', method: 'API key', plan: undefined });
  assert.deepEqual(parseCodexAccount({ account: null, requiresOpenaiAuth: true }), { state: 'logged-out' });
  assert.deepEqual(parseCodexAccount({ account: null, requiresOpenaiAuth: false }), { state: 'logged-in', method: 'No login needed' });
  assert.equal(parseCodexAccount('nope').state, 'unknown');
  assert.doesNotMatch(JSON.stringify(parseCodexAccount(CODEX_PLUS)), /example\.com/);
});
