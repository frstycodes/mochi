import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vite-plus/test';

// oxlint comes through vite-plus, so resolve it from there.
const oxlint = join(dirname(createRequire(createRequire(import.meta.url).resolve('vite-plus/package.json')).resolve('oxlint/package.json')), 'bin/oxlint');
const plugin = fileURLToPath(new URL('../index.ts', import.meta.url));

function lint(source: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-oxlint-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, '.oxlintrc.json'), JSON.stringify({ jsPlugins: [plugin], rules: { 'mochi/no-low-value-comments': 'error' } }));
  writeFileSync(join(dir, 'fixture.ts'), source);
  const { stdout } = spawnSync(process.execPath, [oxlint, '-c', '.oxlintrc.json', '-f', 'json', 'fixture.ts'], { cwd: dir, encoding: 'utf8' });
  return (JSON.parse(stdout) as { diagnostics: { message: string }[] }).diagnostics.map((d) => d.message);
}

test('a TODO naming its owner or condition and a {SECTION} separator pass; a bare TODO and a divider do not', () => {
  assert.deepEqual(lint('// TODO(windows): the fake CLI needs a .cmd shim.\nexport const a = 1;\n// {THREADS}\nexport const listThreads = 2;\n'), []);
  assert.deepEqual(lint('// TODO: tidy this up.\nexport const a = 1;\n// ---- Threads ----\nexport const b = 2;\n'), [
    'Link the issue that tracks this, or drop the marker.',
    "Drop the section divider; split the file or let the code's structure show the grouping.",
  ]);
});
