import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { isSharedSetting, settingsCatalog } from '../settings/catalog.ts';
import { DEFAULT_PREFS } from '../settings/prefs.ts';
import { driftedKeys, sharedValues } from './sharedSettings.ts';

test('what follows you across computers is behaviour; paths, shell, keys, appearance, access and Devices stay with each', () => {
  for (const key of [
    'agent',
    'diffStyle',
    'starredModels',
    'claude.model',
    'alert.needs-you',
    'utility.title',
    'simplifyRules',
    'quietFrom',
    'branchPrefix',
  ])
    assert.ok(isSharedSetting(key), key);
  for (const key of [
    'theme',
    'lightTheme',
    'shell',
    'projectsFolder',
    'worktreeRoot',
    'claude.path',
    'keybinding.palette',
    'permissions',
    'agentControl',
    'remoteEnabled',
    'machineName',
    'demoData',
    'concurrency',
  ])
    assert.equal(isSharedSetting(key), false, key);
  const catalog = settingsCatalog().map((s) => s.key);
  for (const key of catalog.filter(isSharedSetting))
    assert.ok(catalog.includes(key));
});

test('only shared rows are read, and only those both computers know can differ', () => {
  const values = sharedValues({
    prefs: DEFAULT_PREFS,
    theme: 'dark',
    quiet: { isOn: false, start: 22, end: 7 },
  });
  assert.equal(values.diffStyle, DEFAULT_PREFS.diffStyle);
  assert.equal('theme' in values, false, 'appearance stays on each computer');
  assert.equal(
    'claude.model' in values,
    false,
    'main’s settings weren’t loaded, so they aren’t claimed',
  );
  assert.deepEqual(
    driftedKeys(
      { diffStyle: 'split', agent: 'claude', newOne: 'x' },
      { diffStyle: 'unified', agent: 'claude' },
    ),
    ['diffStyle'],
  );
});
