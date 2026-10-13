import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrast, nudge, parseHex, toHex } from './color.ts';
import { customizedThemeText, customTheme, themeSchema } from './custom.ts';
import { pierreDiffColors, scopeColor, themeTokens } from './map.ts';
import { THEME_VARIABLES } from './model.ts';

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
  assert.ok(onDark.r > parseHex('#555555')!.r, 'text on a dark surface gets lighter');
  const onLight = nudge(parseHex('#aaaaaa')!, [white]);
  assert.ok(contrast(onLight, white) >= 4.5);
  assert.ok(onLight.r < parseHex('#aaaaaa')!.r, 'text on a light surface gets darker');
});

test('nudge satisfies every surface at once', () => {
  const surfaces = ['#1e1e1e', '#252526', '#2d2d30'].map((c) => parseHex(c)!);
  const text = nudge(parseHex('#6a6a6a')!, surfaces);
  for (const s of surfaces) assert.ok(contrast(text, s) >= 4.5);
});

test('themeTokens maps VS Code keys onto Mochi tokens', () => {
  const tokens = themeTokens(
    { colors: { 'editor.background': '#282c34', 'editor.foreground': '#abb2bf', 'sideBar.background': '#21252b', 'button.background': '#404754', 'terminal.ansiGreen': '#98c379' }, tokenColors: [] },
    'dark',
  );
  assert.equal(tokens['--background'], '#282c34');
  assert.equal(tokens['--sidebar'], '#21252b');
  assert.equal(tokens['--primary'], '#404754');
  assert.equal(tokens['--success'], undefined, 'ANSI green is not a status color: PR and run states keep Mochi’s');
  assert.equal(tokens['--diff-added'], undefined, 'nor a diff color');
});

test('themeTokens derives missing keys from editor background and foreground', () => {
  const tokens = themeTokens({ colors: { 'editor.background': '#ffffff', 'editor.foreground': '#24292e' }, tokenColors: [] }, 'light');
  assert.equal(tokens['--sidebar'], '#ffffff', 'sidebar falls back to the editor background');
  assert.equal(tokens['--primary'], '#24292e', 'primary falls back to the inverted neutral');
  assert.match(tokens['--border'], /^#24292e[0-9a-f]{2}$/, 'border is translucent foreground');
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
        'gitDecoration.addedResourceForeground': '#0a3a0a',
      },
      tokenColors: [],
    },
    'dark',
  );
  const surfaces = ['--background', '--sidebar', '--card', '--popover'].map((t) => tokens[t]);
  for (const text of ['--foreground', '--muted-foreground', '--subtle-foreground', '--diff-added']) {
    for (const surface of surfaces) assert.ok(ratio(tokens[text], surface) >= 4.5, `${text} ${tokens[text]} on ${surface}`);
  }
  assert.ok(ratio(tokens['--primary-foreground'], tokens['--primary']) >= 4.5);
});

test('themeTokens composites translucent surfaces over the editor background', () => {
  const tokens = themeTokens({ colors: { 'editor.background': '#000000', 'sideBar.background': '#ffffff80' }, tokenColors: [] }, 'dark');
  assert.equal(tokens['--sidebar'], '#808080');
});

test('scopeColor picks the most specific rule, the later one on a tie, and reads syntax tokens from it', () => {
  const rules = [
    { scope: 'keyword', settings: { foreground: '#111111' } },
    { scope: ['string', 'keyword.control'], settings: { foreground: '#222222' } },
    { scope: 'keyword, comment', settings: { foreground: '#333333' } },
    { scope: 'meta.block entity.name.function', settings: { foreground: '#444444' } },
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
    { colors: { 'editor.background': '#282c34', 'editor.foreground': '#abb2bf', 'editorWidget.background': '#21252b', 'input.border': '#21252b', 'panel.border': '#3e4452', focusBorder: '#3e4452' }, tokenColors: [] },
    'dark',
  );
  assert.equal(tokens['--input'], '#abb2bf26', 'invisible input border falls back to translucent foreground');
  assert.equal(tokens['--border'], '#3e4452', 'a visible border is kept');
  assert.ok(ratio(tokens['--ring'], '#282c34') >= 3);
});

test('themeTokens never sets status colors and takes diff colors only from git or gutter keys', () => {
  const colors = { 'editor.background': '#1e1e1e', errorForeground: '#f44747', 'editorWarning.foreground': '#cca700', 'terminal.ansiRed': '#ff0000', 'gitDecoration.deletedResourceForeground': '#f48771' };
  const tokens = themeTokens({ colors, tokenColors: [] }, 'dark');
  for (const status of ['--destructive', '--warning', '--success', '--info', '--merged']) assert.equal(tokens[status], undefined, status);
  assert.equal(tokens['--diff-removed'], '#f48771');
  assert.equal(tokens['--diff-added'], undefined);
});

test('a mochi block overrides mapped and status colors as written, and translucent tokens derive from the result', () => {
  const colors = { 'editor.background': '#1e1e1e', 'editorHoverWidget.background': '#252526' };
  const theme = { colors, tokenColors: [], mochi: { popover: '#102030', success: '#00ff00', 'not-a-variable': '#123456', foreground: 'red' } };
  const tokens = themeTokens(theme, 'dark');
  assert.equal(tokens['--popover'], '#102030');
  assert.equal(tokens['--success'], '#00ff00', 'a theme may set a status color on purpose');
  assert.equal(tokens['--float'], '#102030e6', 'float follows the overridden popover');
  assert.equal(tokens['--not-a-variable'], undefined);
  assert.equal(tokens['--foreground'], themeTokens({ colors, tokenColors: [] }, 'dark')['--foreground'], 'a value that is not hex is ignored');
});

test('pierreDiffColors pins diffs to Mochi’s colors unless the theme or its mochi block has diff colors', () => {
  const ansiOnly = pierreDiffColors({ colors: { 'terminal.ansiGreen': '#00ff00', 'terminal.ansiRed': '#ff0000' }, tokenColors: [] }, 'dark');
  assert.equal(ansiOnly['gitDecoration.addedResourceForeground'], '#07c480');
  assert.equal(ansiOnly['gitDecoration.deletedResourceForeground'], '#ff2e3f');
  const own = pierreDiffColors({ colors: { 'editorGutter.addedBackground': '#587c0c' }, tokenColors: [], mochi: { 'diff-removed': '#aa0000' } }, 'light');
  assert.equal(own['gitDecoration.addedResourceForeground'], '#587c0c');
  assert.equal(own['gitDecoration.deletedResourceForeground'], '#aa0000');
  assert.equal(own['gitDecoration.modifiedResourceForeground'], '#009fff');
});

test('Customize copies a theme into a custom file that looks the same and lists every variable it maps', () => {
  const original = customTheme('one.json', JSON.stringify({ name: 'One', type: 'dark', colors: { 'editor.background': '#282c34', 'editor.foreground': '#abb2bf', 'gitDecoration.addedResourceForeground': '#81b88b' }, tokenColors: [{ scope: 'keyword', settings: { foreground: '#c678dd' } }] }));
  const text = customizedThemeText(original);
  const copy = customTheme('one-custom.json', text);
  assert.equal(copy.label, 'One (custom)');
  assert.equal(copy.kind, 'dark');
  assert.equal(JSON.parse(text).$schema, './mochi-theme.schema.json');
  assert.deepEqual(themeTokens(copy.theme, copy.kind), themeTokens(original.theme, original.kind));
  assert.equal(copy.theme.mochi?.['syntax-keyword'], '#c678dd');
  assert.equal(copy.theme.mochi?.success, undefined, 'status colors are left to Mochi');
  for (const name of Object.keys(copy.theme.mochi ?? {})) assert.ok((THEME_VARIABLES as readonly string[]).includes(name), name);
});

test('the schema lists exactly the editable variables', () => {
  const { properties } = themeSchema();
  assert.deepEqual(Object.keys(properties.mochi.properties), [...THEME_VARIABLES]);
});
