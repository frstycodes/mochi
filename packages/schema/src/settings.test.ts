import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vite-plus/test';
import { Schema } from 'effect';
import {
  AgentSettingsPatch,
  ConfigChange,
  settingsRpc,
} from './ipc/settings.ts';
import { AccountsState, AgentSettings, SettingsFile } from './settings.ts';

const fixtures = JSON.parse(
  readFileSync(new URL('../fixtures/settings.json', import.meta.url), 'utf8'),
);
const roundTrip = <S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  value: unknown,
) => {
  const decoded = Schema.decodeUnknownSync(schema)(value);
  assert.deepEqual(decoded, value);
  assert.deepEqual(Schema.encodeSync(schema)(decoded), value);
};

test('settings, accounts and a v1 settings file round-trip', () => {
  roundTrip(AgentSettings, fixtures.defaults);
  roundTrip(AccountsState, fixtures.accounts);
  roundTrip(SettingsFile, fixtures.file);
  roundTrip(settingsRpc.detect.output, fixtures.install);
  for (const patch of fixtures.patches) roundTrip(AgentSettingsPatch, patch);
  for (const change of fixtures.changes) roundTrip(ConfigChange, change);
});

test('a settings file from before `v` reads as v1, a bare side chat model as a Claude choice', () => {
  const { sideChatModel, ...rest } = fixtures.legacyFile;
  assert.deepEqual(
    Schema.decodeUnknownSync(SettingsFile)(fixtures.legacyFile),
    {
      ...rest,
      v: 1,
      sideChatModel: { provider: 'claude', model: sideChatModel },
    },
  );
  assert.deepEqual(Schema.decodeUnknownSync(SettingsFile)({}), { v: 1 });
  assert.throws(() => Schema.decodeUnknownSync(SettingsFile)({ v: 2 }));
});

test('a patch is checked, trimmed and stripped of undefined fields as validPatch does', () => {
  const decode = Schema.decodeUnknownSync(AgentSettingsPatch);
  assert.deepEqual(
    decode({
      concurrency: undefined,
      shell: '  /bin/zsh ',
      sideChatModel: { provider: 'codex', model: ' gpt-5.5 ' },
      unknown: 1,
    }),
    {
      shell: '/bin/zsh',
      sideChatModel: { provider: 'codex', model: 'gpt-5.5' },
    },
  );
  assert.deepEqual(
    decode({
      setupCommands: { ' /Users/me/app ': ' pnpm i ', '/Users/me/b': '  ' },
    }),
    { setupCommands: { '/Users/me/app': 'pnpm i' } },
  );
  for (const bad of [
    { concurrency: 0 },
    { concurrency: 17 },
    { concurrency: 2.5 },
    { worktreeRoot: 'relative/dir' },
    { prDrafts: 'yes' },
    { appIcon: 'neon' },
    { imageGen: 'claude' },
    { sideChatModel: { provider: 'claude', model: '  ' } },
    { utilityModels: { nap: { provider: 'claude', model: 'x' } } },
    { harnesses: { gpt: {} } },
    { harnesses: { claude: { path: '~/bin/claude' } } },
    { setupCommands: { app: 'pnpm i' } },
  ])
    assert.throws(() => decode(bad), JSON.stringify(bad));
});

test('a rejected API key is never echoed back', () => {
  const key = 'sk-ant-not a key';
  assert.throws(
    () =>
      Schema.decodeUnknownSync(settingsRpc.setApiKey.input)(['claude', key]),
    (error: Error) =>
      !String(error).includes(key) &&
      !String(error.message).includes('not a key'),
  );
  assert.throws(
    () =>
      Schema.decodeUnknownSync(settingsRpc.setApiKey.input)(['codex', null]),
    /no API key/,
  );
  assert.deepEqual(
    Schema.decodeUnknownSync(settingsRpc.setApiKey.input)([
      'claude',
      '  sk-ant-api03-abcdefghijklmnop  ',
    ]),
    ['claude', 'sk-ant-api03-abcdefghijklmnop'],
  );
});

test('config changes carry main’s checks', () => {
  for (const bad of [
    {
      kind: 'mcp-set',
      provider: 'claude',
      server: { name: 'gh', type: 'stdio' },
    },
    {
      kind: 'mcp-set',
      provider: 'claude',
      server: { name: 'bad name', type: 'http', url: 'https://x' },
    },
    { kind: 'mcp-remove', provider: 'claude', name: '../x' },
    { kind: 'skill-import', provider: 'claude', folder: 'skills/pdf' },
    { kind: 'nope', provider: 'claude' },
  ])
    assert.throws(
      () => Schema.decodeUnknownSync(ConfigChange)(bad),
      JSON.stringify(bad),
    );
  assert.throws(() =>
    Schema.decodeUnknownSync(settingsRpc.previewConfig.input)([
      'p',
      Array.from({ length: 21 }, () => fixtures.changes[1]),
    ]),
  );
  assert.throws(() =>
    Schema.decodeUnknownSync(settingsRpc.addAccount.input)(['claude', '   ']),
  );
});
