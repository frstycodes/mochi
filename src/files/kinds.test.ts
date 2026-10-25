import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  fileKind,
  hasTextSource,
  isFilePath,
  MAX_TEXT_PREVIEW,
  parseCsv,
  viewerBody,
  worktreeLink,
} from './kinds.ts';

const text = (t: string) => ({ kind: 'text' as const, text: t });
const binary = { kind: 'binary' as const };

test('a file maps to its preview, falling back to source or the can-not-preview state', () => {
  const body = (
    name: string,
    content: Parameters<typeof viewerBody>[1],
    mediaType?: string,
  ) => viewerBody(fileKind(name, mediaType), content);
  assert.equal(body('src/App.tsx', text('x')), 'code');
  assert.equal(body('README.md', text('# x')), 'markdown');
  assert.equal(body('package.json', text('{}')), 'json');
  assert.equal(body('usage.csv', text('a,b')), 'csv');
  assert.equal(body('export', text('a,b'), 'text/csv'), 'csv');
  assert.equal(body('logo.svg', text('<svg/>')), 'svg');
  assert.equal(body('spec.pdf', binary), 'pdf');
  assert.equal(body('scan', binary, 'application/pdf'), 'pdf');
  assert.equal(body('shot.png', binary), 'image');
  assert.equal(body('paste', binary, 'image/heic'), 'image');
  assert.equal(body('app.wasm', binary), 'none');
  assert.equal(body('data.json', binary), 'none');
  assert.equal(
    body('huge.log', text('x'.repeat(MAX_TEXT_PREVIEW + 1))),
    'none',
  );
  // An all-ASCII PDF loads as text; it still previews, with no source toggle.
  assert.equal(body('plain.pdf', text('%PDF-1.4')), 'pdf');
  assert.deepEqual(
    (
      ['markdown', 'json', 'csv', 'svg', 'pdf', 'image', 'code'] as const
    ).filter(hasTextSource),
    ['markdown', 'json', 'csv', 'svg'],
  );
});

test('inline code counts as a file path only when it names one', () => {
  for (const yes of [
    'src/App.tsx',
    'src/a.ts:12',
    'src/a.ts:12:4',
    './scripts/build.py',
    'package.json',
    'README.md',
    '@scope/pkg/index.js',
  ])
    assert.ok(isFilePath(yes), yes);
  for (const no of [
    'latitude.sid',
    'v1.2.3',
    'foo.bar()',
    'node_modules/x',
    'localhost:5173/src/a.ts',
    'https://x.dev/a.ts',
    'pnpm test',
    '.env',
  ])
    assert.ok(!isFilePath(no), no);
});

test('CSV parsing handles quotes, escaped quotes, embedded newlines and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n"multi\nline",\n'), [
    ['a', 'b'],
    ['x, y', 'say "hi"'],
    ['multi\nline', ''],
  ]);
  assert.deepEqual(parseCsv('a\tb\n1\t2', '\t'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
  assert.deepEqual(parseCsv(''), []);
});

test('a chat path links only when the file exists in the folder, normalised to the viewer link', () => {
  const files = new Set(['src/a.ts', 'README.md', 'docs/my file.md']);
  assert.equal(worktreeLink('src/a.ts', '/r', files), 'src/a.ts');
  assert.equal(worktreeLink('./src/a.ts:12', '/r', files), 'src/a.ts:12');
  assert.equal(worktreeLink('src/a.ts:12:4', '/r', files), 'src/a.ts:12');
  assert.equal(worktreeLink('src/a.ts#L7-L9', '/r', files), 'src/a.ts:7');
  assert.equal(worktreeLink('/r/README.md', '/r', files), 'README.md');
  assert.equal(
    worktreeLink('/src/a.ts', '/r', files),
    'src/a.ts',
    'a markdown link after harden',
  );
  assert.equal(
    worktreeLink('docs/my%20file.md', '/r', files),
    'docs/my file.md',
  );
  assert.equal(worktreeLink('src/missing.ts', '/r', files), null);
  assert.equal(worktreeLink('/elsewhere/src/a.ts', '/r', files), null);
  assert.equal(worktreeLink('100%.md', '/r', files), null);
});
