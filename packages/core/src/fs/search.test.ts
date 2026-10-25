import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vite-plus/test';
import type { SearchLine } from '@mochi/domain/host/types/fs';
import { searchFiles } from './search.ts';

const PLAIN = { isCaseSensitive: false, isRegex: false, isWholeWord: false };

function fixture() {
  const base = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), 'harness-search-')),
  );
  const root = path.join(base, 'root');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, 'dist'));
  writeFileSync(path.join(base, 'secret.txt'), 'needle outside');
  writeFileSync(
    path.join(root, 'src', 'a.ts'),
    'const needle = 1;\nconst other = 2;\n  return Needle.find(needles);\n',
  );
  writeFileSync(path.join(root, 'src', 'b.ts'), 'no match here\n');
  writeFileSync(path.join(root, 'dist', 'bundle.js'), 'needle ignored');
  writeFileSync(
    path.join(root, 'image.bin'),
    Buffer.from([110, 101, 101, 100, 108, 101, 0, 1]),
  );
  writeFileSync(path.join(root, 'big.txt'), `needle ${'x'.repeat(2048)}`);
  writeFileSync(path.join(root, '.gitignore'), 'dist/\n');
  symlinkSync(path.join(base, 'secret.txt'), path.join(root, 'escape.txt'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

async function collect(
  root: string,
  pattern: string,
  options = PLAIN,
  limits = {},
) {
  const hits: { path: string; lines: SearchLine[] }[] = [];
  const summary = await searchFiles(
    root,
    pattern,
    options,
    (p, lines) => hits.push({ path: p, lines }),
    { maxFileBytes: 1024, ...limits },
  );
  return { hits, summary };
}

test('searchFiles skips ignored, binary, oversized and escaping files', async () => {
  const { hits, summary } = await collect(fixture(), 'needle');
  assert.deepEqual(
    hits.map((h) => [h.path, h.lines.map((l) => l.line)]),
    [['src/a.ts', [1, 3]]],
  );
  assert.equal(summary.isTruncated, false);
  const [, third] = hits[0].lines;
  assert.equal(third.text, 'return Needle.find(needles);');
  assert.deepEqual(third.ranges, [
    [7, 13],
    [19, 25],
  ]);
  assert.deepEqual(third.column, [9, 15]);
});

test('searchFiles honours case, whole word and regex', async () => {
  const root = fixture();
  const lines = async (pattern: string, options: Partial<typeof PLAIN>) =>
    (await collect(root, pattern, { ...PLAIN, ...options })).hits.flatMap((h) =>
      h.lines.map((l) => l.line),
    );
  assert.deepEqual(await lines('Needle', { isCaseSensitive: true }), [3]);
  assert.deepEqual(
    (await collect(root, 'needle', { ...PLAIN, isWholeWord: true })).hits[0]
      .lines[1].ranges,
    [[7, 13]],
  );
  assert.deepEqual(await lines('other|match', { isRegex: true }), [2, 1]);
  assert.deepEqual(await lines('^', { isRegex: true }), []);
});

test('searchFiles stops at the match cap', async () => {
  const { hits, summary } = await collect(fixture(), 'e', PLAIN, {
    maxMatches: 2,
  });
  assert.equal(hits.flatMap((h) => h.lines).length, 2);
  assert.equal(summary.isTruncated, true);
});

test('searchFiles stops when cancelled', async () => {
  const controller = new AbortController();
  const seen: string[] = [];
  await searchFiles(
    fixture(),
    'e',
    PLAIN,
    (p) => {
      seen.push(p);
      controller.abort();
    },
    { signal: controller.signal, maxFileBytes: 1024 },
  );
  assert.equal(seen.length, 1);
});
