import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { parseJsonc } from './jsonc.ts';
import { extractThemes, parseTheme, resolvePath } from './vsix.ts';
import type { Inflate } from './zip.ts';

const inflate: Inflate = async (data, maxBytes) => inflateRawSync(data, { maxOutputLength: maxBytes });

/** A minimal zip: each file deflated, local headers, then the central directory. CRCs are zero; the reader never checks them. */
function zip(files: Record<string, string>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = deflateRawSync(Buffer.from(text));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(Buffer.byteLength(text), 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(Buffer.byteLength(text), 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const manifest = (themes: unknown[]) => JSON.stringify({ name: 'x', contributes: { themes } });

test('parseJsonc reads comments and trailing commas but leaves them inside strings', () => {
  const text = '﻿{\n // line\n "a": "http://x/*y*/", /* block */ "b": [1, 2,],\n "c": "a, }",\n}';
  assert.deepEqual(parseJsonc(text), { a: 'http://x/*y*/', b: [1, 2], c: 'a, }' });
});

test('extractThemes resolves include chains inside the package, included file first', async () => {
  const bytes = zip({
    'extension/package.json': manifest([{ label: 'Night', uiTheme: 'vs-dark', path: './themes/night.json' }]),
    'extension/themes/night.json': '{ "include": "../base/base.jsonc", "colors": { "editor.background": "#000000" }, "tokenColors": [{ "scope": "string", "settings": { "foreground": "#00ff00" } }] }',
    'extension/base/base.jsonc': '// base\n{ "colors": { "editor.background": "#111111", "editor.foreground": "#eeeeee", }, "tokenColors": [{ "scope": "comment", "settings": { "foreground": "#777777" } }] }',
    'extension/images/icon.png': 'not read',
  });
  const [theme] = await extractThemes(bytes, inflate);
  assert.equal(theme.label, 'Night');
  assert.equal(theme.kind, 'dark');
  assert.deepEqual(theme.theme.colors, { 'editor.background': '#000000', 'editor.foreground': '#eeeeee' });
  assert.deepEqual(theme.theme.tokenColors.map((r) => r.scope), ['comment', 'string']);
});

test('extractThemes reads tokenColors given as a path to a JSON file', async () => {
  const bytes = zip({
    'extension/package.json': manifest([{ label: 'Day', uiTheme: 'vs', path: 'day.json' }]),
    'extension/day.json': '{ "colors": {}, "tokenColors": "./tokens.json" }',
    'extension/tokens.json': '[{ "scope": "keyword", "settings": { "foreground": "#ff0000" } }]',
  });
  const [theme] = await extractThemes(bytes, inflate);
  assert.equal(theme.kind, 'light');
  assert.equal(theme.theme.tokenColors[0].scope, 'keyword');
});

test('extractThemes rejects theme and include paths that escape the package', async () => {
  const outside = zip({ 'extension/package.json': manifest([{ label: 'X', path: '../secret.json' }]), 'secret.json': '{}' });
  await assert.rejects(extractThemes(outside, inflate), /outside the package/);
  const viaInclude = zip({
    'extension/package.json': manifest([{ label: 'X', path: 'themes/a.json' }]),
    'extension/themes/a.json': '{ "include": "../../secret.json" }',
    'secret.json': '{}',
  });
  await assert.rejects(extractThemes(viaInclude, inflate), /outside the package/);
  const absolute = zip({ 'extension/package.json': manifest([{ label: 'X', path: '/etc/passwd' }]) });
  await assert.rejects(extractThemes(absolute, inflate), /inside the package/);
});

test('extractThemes refuses include cycles and oversized files', async () => {
  const cycle = zip({
    'extension/package.json': manifest([{ label: 'X', path: 'a.json' }]),
    'extension/a.json': '{ "include": "./b.json" }',
    'extension/b.json': '{ "include": "./a.json" }',
  });
  await assert.rejects(extractThemes(cycle, inflate), /cycle/);
  const huge = zip({ 'extension/package.json': manifest([{ label: 'X', path: 'a.json' }]), 'extension/a.json': `{ "name": "${'x'.repeat(5 * 1024 * 1024)}" }` });
  await assert.rejects(extractThemes(huge, inflate), /larger than/);
});

test('extractThemes returns nothing for a package without color themes', async () => {
  assert.deepEqual(await extractThemes(zip({ 'extension/package.json': JSON.stringify({ contributes: { iconThemes: [] } }) }), inflate), []);
});

test('resolvePath stays inside the package', () => {
  assert.equal(resolvePath('themes', './a/../b.json'), 'themes/b.json');
  assert.equal(resolvePath('', 'themes\\c.json'), 'themes/c.json');
  assert.throws(() => resolvePath('themes', '../../x.json'), /outside/);
  assert.throws(() => resolvePath('', 'file:///etc/passwd'), /inside the package/);
});

test('parseTheme validates pasted JSON', () => {
  assert.equal(parseTheme('{ "type": "light", "colors": { "editor.background": "#fff" } }').type, 'light');
  assert.throws(() => parseTheme('[]'), /JSON object/);
  assert.throws(() => parseTheme('{ "name": "x" }'), /colors/);
  assert.throws(() => parseTheme('{ "include": "./base.json", "colors": {} }'), /import it as a file/);
});
