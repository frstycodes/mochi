import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiffFile } from '../host/types/git.ts';
import { DEFAULT_SETTINGS, mergeSettings } from '../host/types/settings.ts';
import { commitPrompt, goalPrompt, handoffPrompt, parseCommit, parsePr, parseSteps, parseTitle, prPrompt, titlePrompt, utilityCandidates, UTILITY_TASKS } from './prompts.ts';

const file = (path: string, patch: string): DiffFile => ({ path, kind: 'modified', staged: true, binary: false, added: 2, removed: 1, patch, hunks: [] });

test('every task defaults to Haiku 5.5, and changing one task keeps the others', () => {
  for (const task of UTILITY_TASKS) assert.deepEqual(DEFAULT_SETTINGS.utilityModels[task], { provider: 'claude', model: 'claude-haiku-5-5' });
  const next = mergeSettings(DEFAULT_SETTINGS, { utilityModels: { pr: { provider: 'codex', model: 'gpt-6-sol' } } });
  assert.deepEqual(next.utilityModels.pr, { provider: 'codex', model: 'gpt-6-sol' });
  assert.deepEqual(next.utilityModels.title, DEFAULT_SETTINGS.utilityModels.title);
});

test('candidates: your choice, then Haiku, then Luna, no repeats', () => {
  assert.deepEqual(utilityCandidates({ provider: 'claude', model: 'claude-haiku-5-5' }), [
    { provider: 'claude', model: 'claude-haiku-5-5' },
    { provider: 'codex', model: 'gpt-6-luna' },
  ]);
  assert.deepEqual(
    utilityCandidates({ provider: 'codex', model: 'gpt-6-sol' }).map((c) => c.model),
    ['gpt-6-sol', 'claude-haiku-5-5', 'gpt-6-luna'],
  );
});

test('prompt builders carry the input and cut what would stall a call', () => {
  assert.equal(titlePrompt('Fix the login redirect', 'Done, the callback now keeps ?next.'), 'User: Fix the login redirect\n\nAgent: Done, the callback now keeps ?next.');
  const commit = commitPrompt([file('src/auth.ts', '@@ -1 +1 @@\n-a\n+b'), { ...file('logo.png', ''), binary: true }]);
  assert.match(commit, /^src\/auth\.ts \(modified, \+2 −1\)\n@@ -1 \+1 @@/);
  assert.match(commit, /logo\.png \(modified, \+2 −1\)$/);
  assert.match(prPrompt('Login fix', 'Fix the login redirect', [file('a.ts', '+x')]), /^Thread: Login fix\nGoal: Fix the login redirect\n\na\.ts/);
  assert.equal(goalPrompt('Ship dark mode'), 'Goal: Ship dark mode');
  assert.match(handoffPrompt('**Goal:** x', ['You: keep the API', 'Agent: ok']), /\*\*Goal:\*\* x\n\nRecent transcript:\nYou: keep the API\n\nAgent: ok/);
  const huge = commitPrompt([file('big.ts', 'x'.repeat(50_000))]);
  assert.ok(huge.length < 25_000 && huge.endsWith('… (cut)'));
});

test('parsers clean what models add around the answer', () => {
  assert.equal(parseTitle('"Fix login redirect."\n'), 'Fix login redirect');
  assert.equal(parseTitle('# Title: Rate limiter for the API'), 'Rate limiter for the API');
  assert.equal(parseTitle('  \n'), '');
  assert.equal(parseTitle('x'.repeat(80)).length, 60);
  assert.equal(parseCommit('```\nfix(auth): keep next param\n\nThe callback dropped it.\n```'), 'fix(auth): keep next param\n\nThe callback dropped it.');
  assert.deepEqual(parsePr('Title: Keep ?next through login\n\n## What\nThe callback keeps it.'), { title: 'Keep ?next through login', body: '## What\nThe callback keeps it.' });
  assert.deepEqual(parseSteps('1. Read the auth flow\n- Fix the callback\n\n* Add a test'), ['Read the auth flow', 'Fix the callback', 'Add a test']);
});
