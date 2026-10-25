import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { contrast, nudge, parseHex, toHex } from '@mochi/domain/themes/color';
import githubLight from 'shiki/dist/themes/github-light.mjs';
import {
  LIGHT_CODE_SURFACES,
  readableTokenColors,
  scopeColor,
  themeTokens,
} from './map.ts';

const ratio = (a: string, b: string) => contrast(parseHex(a)!, parseHex(b)!);

test('parseHex reads the four VS Code hex forms and toHex round-trips them', () => {
  assert.equal(toHex(parseHex('#abc')!), '#aabbcc');
  assert.equal(toHex(parseHex('#abcd')!), '#aabbccdd');
  assert.equal(toHex(parseHex('#1e1e1e')!), '#1e1e1e');
  assert.equal(toHex(parseHex('#ffffff80')!), '#ffffff80');
  assert.equal(parseHex('red'), null);
  assert.equal(parseHex(undefined), null);
});

test('nudge leaves passing text alone and pushes failing text to 4.5:1 in the direction with room', () => {
  const white = parseHex('#ffffff')!;
  const passing = parseHex('#333333')!;
  assert.deepEqual(nudge(passing, [white]), passing);
  const onDark = nudge(parseHex('#555555')!, [parseHex('#1e1e1e')!]);
  assert.ok(contrast(onDark, parseHex('#1e1e1e')!) >= 4.5);
  assert.ok(
    onDark.r > parseHex('#555555')!.r,
    'text on a dark surface gets lighter',
  );
  const onLight = nudge(parseHex('#aaaaaa')!, [white]);
  assert.ok(contrast(onLight, white) >= 4.5);
  assert.ok(
    onLight.r < parseHex('#aaaaaa')!.r,
    'text on a light surface gets darker',
  );
});

test('nudge satisfies every surface at once', () => {
  const surfaces = ['#1e1e1e', '#252526', '#2d2d30'].map((c) => parseHex(c)!);
  const text = nudge(parseHex('#6a6a6a')!, surfaces);
  for (const s of surfaces) assert.ok(contrast(text, s) >= 4.5);
});

test('themeTokens maps VS Code keys onto Mochi tokens', () => {
  const tokens = themeTokens(
    {
      colors: {
        'editor.background': '#282c34',
        'editor.foreground': '#abb2bf',
        'sideBar.background': '#21252b',
        'button.background': '#404754',
        'terminal.ansiGreen': '#98c379',
      },
      tokenColors: [],
    },
    'dark',
  );
  assert.equal(tokens['--background'], '#282c34');
  assert.equal(tokens['--sidebar'], '#21252b');
  assert.equal(tokens['--primary'], '#404754');
  assert.equal(tokens['--success'], '#98c379');
});

test('themeTokens derives missing keys from editor background and foreground', () => {
  const tokens = themeTokens(
    {
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#24292e',
      },
      tokenColors: [],
    },
    'light',
  );
  assert.equal(
    tokens['--sidebar'],
    '#ffffff',
    'sidebar falls back to the editor background',
  );
  assert.equal(
    tokens['--primary'],
    '#24292e',
    'primary falls back to the inverted neutral',
  );
  assert.match(
    tokens['--border'],
    /^#24292e[0-9a-f]{2}$/,
    'border is translucent foreground',
  );
  assert.ok(ratio(tokens['--muted-foreground'], '#ffffff') >= 4.5);
});

test('themeTokens enforces 4.5:1 on every text pair a theme gets wrong', () => {
  const tokens = themeTokens(
    {
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#444444',
        'button.background': '#0e639c',
        'button.foreground': '#2a6a9a',
        descriptionForeground: '#3a3a3a',
        errorForeground: '#5a1010',
      },
      tokenColors: [],
    },
    'dark',
  );
  const surfaces = ['--background', '--sidebar', '--card', '--popover'].map(
    (t) => tokens[t],
  );
  for (const text of [
    '--foreground',
    '--muted-foreground',
    '--subtle-foreground',
    '--destructive',
    '--success',
    '--warning',
    '--info',
  ]) {
    for (const surface of surfaces)
      assert.ok(
        ratio(tokens[text], surface) >= 4.5,
        `${text} ${tokens[text]} on ${surface}`,
      );
  }
  assert.ok(ratio(tokens['--primary-foreground'], tokens['--primary']) >= 4.5);
});

test('themeTokens composites translucent surfaces over the editor background', () => {
  const tokens = themeTokens(
    {
      colors: {
        'editor.background': '#000000',
        'sideBar.background': '#ffffff80',
      },
      tokenColors: [],
    },
    'dark',
  );
  assert.equal(tokens['--sidebar'], '#808080');
});

test('scopeColor picks the most specific rule, the later one on a tie, and reads syntax tokens from it', () => {
  const rules = [
    { scope: 'keyword', settings: { foreground: '#111111' } },
    {
      scope: ['string', 'keyword.control'],
      settings: { foreground: '#222222' },
    },
    { scope: 'keyword, comment', settings: { foreground: '#333333' } },
    {
      scope: 'meta.block entity.name.function',
      settings: { foreground: '#444444' },
    },
    { settings: { foreground: '#999999' } },
  ];
  assert.equal(scopeColor(rules, 'keyword.operator'), '#333333');
  assert.equal(scopeColor(rules, 'keyword.control.flow'), '#222222');
  assert.equal(scopeColor(rules, 'entity.name.function.ts'), '#444444');
  assert.equal(scopeColor(rules, 'constant'), undefined);
  const tokens = themeTokens({ colors: {}, tokenColors: rules }, 'dark');
  assert.equal(tokens['--syntax-keyword'], '#222222');
  assert.equal(tokens['--syntax-comment'], '#333333');
});

test('themeTokens drops borders a theme draws in its own surface color and keeps the focus ring at 3:1', () => {
  const tokens = themeTokens(
    {
      colors: {
        'editor.background': '#282c34',
        'editor.foreground': '#abb2bf',
        'editorWidget.background': '#21252b',
        'input.border': '#21252b',
        'panel.border': '#3e4452',
        focusBorder: '#3e4452',
      },
      tokenColors: [],
    },
    'dark',
  );
  assert.equal(
    tokens['--input'],
    '#abb2bf26',
    'invisible input border falls back to translucent foreground',
  );
  assert.equal(tokens['--border'], '#3e4452', 'a visible border is kept');
  assert.ok(ratio(tokens['--ring'], '#282c34') >= 3);
});

test('readableTokenColors brings every github-light token to AA on the chat code surfaces', () => {
  const tokenColors = readableTokenColors(
    githubLight.tokenColors!,
    LIGHT_CODE_SURFACES,
  );
  for (const { settings } of tokenColors)
    for (const surface of LIGHT_CODE_SURFACES)
      if (!settings.background && parseHex(settings.foreground))
        assert.ok(
          ratio(settings.foreground!, surface) >= 4.5,
          `${settings.foreground} on ${surface}`,
        );
  assert.equal(
    scopeColor(tokenColors, 'string'),
    scopeColor(githubLight.tokenColors!, 'string'),
    'a passing color is kept as written',
  );
  assert.deepEqual(
    tokenColors.filter((r) => r.settings.background),
    githubLight.tokenColors!.filter((r) => r.settings.background),
    'rules on their own background are kept',
  );
});
