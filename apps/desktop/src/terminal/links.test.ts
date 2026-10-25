import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { fileLink, filePathsIn } from './links.ts';

test('file paths with line and column are found, URL paths are left to the URL matcher', () => {
  const line =
    ' FAIL apps/api/usage.test.ts:18:5 see ./src/a.tsx and http://localhost:5173/src/main.ts or /tmp/x.log';
  assert.deepEqual(
    filePathsIn(line).map((p) => p.text),
    ['apps/api/usage.test.ts:18:5', './src/a.tsx', '/tmp/x.log'],
  );
  assert.deepEqual(filePathsIn('pnpm run dev'), []);
  assert.equal(filePathsIn('x src/b.ts').at(0)?.start, 2);
});

test('a file link keeps its line and drops the column', () => {
  assert.deepEqual(fileLink('src/a.ts:12:4'), { path: 'src/a.ts', line: 12 });
  assert.deepEqual(fileLink('src/a.ts'), { path: 'src/a.ts', line: undefined });
});
