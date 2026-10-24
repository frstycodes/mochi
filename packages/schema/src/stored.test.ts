import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vite-plus/test';
import { Schema } from 'effect';
import { LegacyProjectRecents, Pins, Prefs, Profile, Profiles, ProjectRegistryFile, StoredPrefs, StoredThemes } from './stored.ts';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/stored.json', import.meta.url), 'utf8'));
const roundTrip = <S extends Schema.Codec<unknown, unknown>>(schema: S, value: unknown) => {
  const decoded = Schema.decodeUnknownSync(schema)(value);
  assert.deepEqual(decoded, value);
  assert.deepEqual(Schema.encodeSync(schema)(decoded), value);
};
const withoutV = <T extends object>({ v: _, ...row }: T & { v?: number }) => row;

test('every stored row round-trips at v1', () => {
  roundTrip(StoredPrefs, fixtures.prefs);
  roundTrip(Prefs, withoutV(fixtures.prefs));
  roundTrip(Profiles, fixtures.profiles);
  roundTrip(Pins, fixtures.pins);
  roundTrip(StoredThemes, fixtures.themes);
  roundTrip(ProjectRegistryFile, fixtures.projectRegistry);
  roundTrip(LegacyProjectRecents, fixtures.legacyProjectRecents);
});

test('rows saved before `v` read as v1', () => {
  assert.deepEqual(Schema.decodeUnknownSync(Profiles)(fixtures.legacyProfiles), fixtures.legacyProfiles.map((p: object) => ({ ...p, v: 1 })));
  assert.deepEqual(Schema.decodeUnknownSync(Pins)(fixtures.legacyPins), { t1: fixtures.legacyPins.t1.map((p: object) => ({ ...p, v: 1 })) });
  const { v: _, ...themes } = fixtures.themes;
  assert.deepEqual(Schema.decodeUnknownSync(StoredThemes)(themes), fixtures.themes);
  const registry = structuredClone(fixtures.projectRegistry);
  for (const p of registry.spaces.personal.projects) delete p.v;
  assert.deepEqual(Schema.decodeUnknownSync(ProjectRegistryFile)(registry), fixtures.projectRegistry);
});

test('unversioned prefs read as parsePrefs reads them: mistyped values dropped, renamed access mapped, retired keys gone', () => {
  assert.deepEqual(Schema.decodeUnknownSync(StoredPrefs)(fixtures.legacyPrefs.in), fixtures.legacyPrefs.out);
  assert.deepEqual(Schema.decodeUnknownSync(StoredPrefs)({ permissions: 'Plan' }), { v: 1, permissions: 'Auto' });
  assert.deepEqual(Schema.decodeUnknownSync(StoredPrefs)({}), { v: 1 });
  assert.throws(() => Schema.decodeUnknownSync(StoredPrefs)({ v: 2, agent: 'claude' }));
  assert.throws(() => Schema.decodeUnknownSync(StoredPrefs)({ v: 1, agent: 'gpt' }), 'a v1 row is written checked, so it is decoded strictly');
});

test('a profile id names folders: isProfile’s pattern holds', () => {
  const ok = fixtures.legacyProfiles[0];
  for (const id of ['Personal', '../x', 'a b', '']) assert.throws(() => Schema.decodeUnknownSync(Profile)({ ...ok, id }), id);
  assert.throws(() => Schema.decodeUnknownSync(Profile)({ ...ok, icon: 'unicorn' }));
  assert.throws(() => Schema.decodeUnknownSync(Profile)({ ...ok, plans: { claude: 'Max' } }));
});
