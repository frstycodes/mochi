import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentModel } from '../host/types/agent.ts';
import { effortId, optionFor, resolveRun, searchModels, type ModelOption } from './models.ts';

const CODEX: AgentModel[] = [
  { id: 'gpt-6-astra', name: 'GPT-6-Astra', description: '', efforts: ['low', 'medium', 'high', 'ultra'], defaultEffort: 'low', isDefault: true },
  { id: 'gpt-6-luna', name: 'GPT-6-Luna', description: '', efforts: ['low', 'medium'], defaultEffort: 'medium', isDefault: false },
];

test('a run always names a model the account offers', () => {
  assert.deepEqual(resolveRun(CODEX, 'gpt-6-luna', 'low'), { model: 'gpt-6-luna', effort: 'low' });
  assert.deepEqual(resolveRun(CODEX, 'gpt-6.1-sol', 'high'), { model: 'gpt-6-astra', effort: 'high' }, 'a rejected id falls back to the default');
  assert.deepEqual(resolveRun(CODEX, undefined, 'high'), { model: 'gpt-6-astra', effort: 'high' }, 'no choice is sent as the explicit default');
  assert.deepEqual(resolveRun(CODEX, 'gpt-6-luna', 'ultra'), { model: 'gpt-6-luna', effort: 'medium' }, "an effort the model lacks runs the model's default");
  assert.deepEqual(resolveRun([], 'gpt-6-luna', 'low'), { model: 'gpt-6-luna', effort: 'low' }, 'an unread list passes the choice through');
});

test('the picker shows a model the account no longer offers as Unavailable, with the default it runs', () => {
  assert.equal(optionFor(CODEX, 'gpt-6-luna', 'codex').name, 'GPT-6-Luna');
  assert.equal(optionFor(CODEX, '', 'codex').id, 'gpt-6-astra', "'' is the account default");
  const gone = optionFor(CODEX, 'gpt-5.5-codex', 'codex');
  assert.equal(gone.isUnavailable, true);
  assert.equal(gone.description, 'Unavailable, runs GPT-6-Astra');
  assert.deepEqual(gone.efforts, CODEX[0].efforts);
  assert.equal(optionFor(undefined, 'gpt-5.5-codex', 'codex').isUnavailable, undefined, 'not judged before the list arrives');
});

test('efforts saved as chip labels read as provider ids', () => {
  assert.equal(effortId('Extra high'), 'xhigh');
  assert.equal(effortId('High'), 'high');
  assert.equal(effortId('ultra'), 'ultra');
});

test('model search matches every typed word as a substring, across harnesses', () => {
  const models: ModelOption[] = [
    { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', description: '', efforts: [], isDefault: false, harness: 'claude' },
    { id: 'claude-opus-5-5', name: 'Opus 5.5', description: '', efforts: [], isDefault: true, harness: 'claude' },
    ...CODEX.map((m) => ({ ...m, harness: 'codex' as const })),
  ];
  const ids = (q: string) => searchModels(models, q).map((m) => m.id);
  assert.deepEqual(ids('luna'), ['gpt-6-luna'], 'no fuzzy hit in "cLaUde soNnet"');
  assert.deepEqual(ids('5.5'), ['claude-sonnet-5-5', 'claude-opus-5-5']);
  assert.deepEqual(ids('codex'), ['gpt-6-astra', 'gpt-6-luna'], 'the harness name matches');
  assert.deepEqual(ids('  OPUS   claude '), ['claude-opus-5-5'], 'words in any order, any case');
  assert.equal(ids('').length, 4);
  assert.deepEqual(ids('opus luna'), []);
});
