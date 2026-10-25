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
import { resolveInside } from '@mochi/core/fs/contain';
import { listFiles } from '@mochi/core/fs/list';
import { fuzzyFiles } from '@mochi/domain/files/fuzzy';

function fixture() {
  // `.native` also expands Windows 8.3 short names, as resolveInside's own realpath does.
  const base = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), 'harness-fs-')),
  );
  const root = path.join(base, 'root');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, 'dist'));
  writeFileSync(path.join(base, 'secret.txt'), 'outside');
  writeFileSync(path.join(root, 'src', 'app.ts'), 'in');
  writeFileSync(path.join(root, 'dist', 'bundle.js'), 'ignored');
  writeFileSync(path.join(root, 'debug.log'), 'ignored');
  writeFileSync(path.join(root, '.gitignore'), 'dist/\n*.log\n');
  symlinkSync(path.join(base, 'secret.txt'), path.join(root, 'escape.txt'));
  symlinkSync(path.join(root, 'src', 'app.ts'), path.join(root, 'alias.ts'));
  return root;
}

test('resolveInside keeps every path inside the root', async () => {
  const root = fixture();
  assert.equal(
    await resolveInside(root, 'src/app.ts'),
    path.join(root, 'src', 'app.ts'),
  );
  assert.equal(
    await resolveInside(root, 'alias.ts'),
    path.join(root, 'src', 'app.ts'),
  );
  for (const bad of [
    '../secret.txt',
    'src/../../secret.txt',
    path.join(root, 'src/app.ts'),
    'escape.txt',
    '.',
    'src/\0app.ts',
  ])
    await assert.rejects(
      resolveInside(root, bad),
      `${JSON.stringify(bad)} must be rejected`,
    );
});

test('listFiles honours .gitignore', async () => {
  const root = fixture();
  execFileSync('git', ['init', '-q'], { cwd: root });
  const files = await listFiles(root);
  assert.deepEqual(files, [
    '.gitignore',
    'alias.ts',
    'escape.txt',
    'src/app.ts',
  ]);
});

test('fuzzyFiles ranks a basename hit above a scattered path match', () => {
  const files = [
    'src/components/ui/button.tsx',
    'src/pane/FilesTab.tsx',
    'src/files/fuzzy.ts',
  ];
  assert.deepEqual(fuzzyFiles(files, 'ftab'), ['src/pane/FilesTab.tsx']);
  assert.equal(fuzzyFiles(files, 'fuzzy')[0], 'src/files/fuzzy.ts');
  assert.deepEqual(fuzzyFiles(files, 'zzz'), []);
});
