import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupThemes, slotsUsing } from './groups.ts';
import { marketplaceThemeId, type ColorTheme, type ThemeKind } from './model.ts';

const theme = { colors: {}, tokenColors: [] };

function fromPackage(namespace: string, name: string, displayName: string, label: string, kind: ThemeKind): ColorTheme {
  return { id: marketplaceThemeId(namespace, name, label), label, kind, source: { kind: 'marketplace', namespace, name, version: '1.0.0', displayName, publisher: namespace }, theme };
}

const custom: ColorTheme = { id: 'custom:mine.json', label: 'Mine', kind: 'dark', source: { kind: 'custom', file: 'mine.json' }, theme };
const latte = fromPackage('catppuccin', 'catppuccin-vsc', 'Catppuccin', 'Latte', 'light');
const mocha = fromPackage('catppuccin', 'catppuccin-vsc', 'Catppuccin', 'Mocha', 'dark');
const ayu = fromPackage('teabyii', 'ayu', 'Ayu', 'Ayu Dark', 'dark');

test('groupThemes puts every theme of a package in one group, packages by name, themes in contributed order', () => {
  const { packages, custom: customThemes } = groupThemes([latte, custom, ayu, mocha]);
  assert.deepEqual(
    packages.map((p) => [p.id, p.displayName, p.publisher, p.themes.map((t) => t.label)]),
    [
      ['teabyii.ayu', 'Ayu', 'teabyii', ['Ayu Dark']],
      ['catppuccin.catppuccin-vsc', 'Catppuccin', 'catppuccin', ['Latte', 'Mocha']],
    ],
  );
  assert.deepEqual(customThemes, [custom]);
});

test('groupThemes on nothing installed is empty', () => {
  assert.deepEqual(groupThemes([]), { packages: [], custom: [] });
});

test('slotsUsing names the slots a removed package was filling and leaves the others', () => {
  const [catppuccin] = groupThemes([latte, mocha]).packages;
  assert.deepEqual(slotsUsing(catppuccin.themes, { lightTheme: latte.id, darkTheme: mocha.id }), ['light', 'dark']);
  assert.deepEqual(slotsUsing(catppuccin.themes, { lightTheme: 'mochi', darkTheme: mocha.id }), ['dark']);
  assert.deepEqual(slotsUsing(catppuccin.themes, { lightTheme: 'mochi', darkTheme: ayu.id }), []);
});
