import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { devTarget } from '../../src/terminal/lsof.ts';
import { debounce, DEBOUNCE_MS, isHmrLog, isIgnored, ScrollMemory, watchTree } from './reload.ts';

test('isIgnored skips build, cache and VCS dirs and editor temp files, nothing else', () => {
  for (const rel of ['node_modules/react/index.js', '.git/index', 'dist/assets/app.js', 'web/.next/cache/x', 'src/.DS_Store', 'src/App.tsx~', 'src/.App.tsx.swp', 'node_modules\\react\\index.js']) assert.ok(isIgnored(rel), rel);
  for (const rel of ['src/App.tsx', 'index.html', 'public/build-info.json', 'src/distance.ts']) assert.ok(!isIgnored(rel), rel);
});

test('debounce runs once after the burst settles', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const fire = debounce(() => calls++, 100);
  fire();
  t.mock.timers.tick(60);
  fire();
  t.mock.timers.tick(60);
  assert.equal(calls, 0);
  t.mock.timers.tick(40);
  assert.equal(calls, 1);
  fire();
  fire.cancel();
  t.mock.timers.tick(200);
  assert.equal(calls, 1);
});

test('watchTree reports one change per burst, with its start, and ignores node_modules', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mochi-watch-'));
  mkdirSync(join(root, 'node_modules'));
  mkdirSync(join(root, 'src'));
  const seen: number[] = [];
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // FSEvents delivers writes from just before the watch started; let the setup's own mkdirs pass first.
  await wait(500);
  const stop = watchTree(root, (since) => seen.push(since));
  try {
    await wait(100);
    writeFileSync(join(root, 'node_modules', 'dep.js'), '1');
    await wait(DEBOUNCE_MS + 200);
    assert.equal(seen.length, 0);
    const before = Date.now();
    writeFileSync(join(root, 'src', 'a.ts'), '1');
    writeFileSync(join(root, 'src', 'b.ts'), '1');
    await wait(DEBOUNCE_MS + 200);
    assert.equal(seen.length, 1);
    assert.ok(seen[0] >= before && seen[0] <= before + 100);
  } finally {
    stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('isHmrLog knows the dev servers that reload pages themselves', () => {
  assert.ok(isHmrLog('[vite] hot updated: /src/App.tsx'));
  assert.ok(isHmrLog('[vite] page reload src/main.ts'));
  assert.ok(isHmrLog('[HMR] Updated modules:'));
  assert.ok(isHmrLog('[Fast Refresh] done in 120ms'));
  assert.ok(!isHmrLog('[vite] connected.'));
});

test('ScrollMemory restores per URL once, while fresh, ignoring the hash', () => {
  const memory = new ScrollMemory();
  memory.remember('http://localhost:5173/a#x', { x: 0, y: 400 }, 1000);
  memory.remember('http://localhost:5173/b', { x: 0, y: 900 }, 1000);
  assert.deepEqual(memory.take('http://localhost:5173/a', 2000), { x: 0, y: 400 });
  assert.equal(memory.take('http://localhost:5173/a', 2000), null);
  assert.equal(memory.take('http://localhost:5173/b', 20_000), null);
  memory.remember('http://localhost:5173/c', { x: 0, y: 0 }, 1000);
  assert.equal(memory.take('http://localhost:5173/c', 1500), null);
});

test('devTarget prefers the dev script, then start, then other scripts, then launch.json', () => {
  const t = (name: string, source: 'package.json' | 'launch.json' = 'package.json') => ({ name, command: name, source });
  assert.equal(devTarget([t('web', 'launch.json'), t('electron:dev'), t('start'), t('dev')])?.name, 'dev');
  assert.equal(devTarget([t('web', 'launch.json'), t('electron:dev')])?.name, 'electron:dev');
  assert.equal(devTarget([]), null);
});
