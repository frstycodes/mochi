import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vite-plus/test';
import { devTarget } from '../../src/terminal/lsof.ts';
import {
  debounce,
  DEBOUNCE_MS,
  isHmrLog,
  isIgnored,
  ScrollMemory,
  watchTree,
} from './reload.ts';

afterEach(() => vi.useRealTimers());

test('isIgnored skips build, cache and VCS dirs and editor temp files, nothing else', () => {
  for (const rel of [
    'node_modules/react/index.js',
    '.git/index',
    'dist/assets/app.js',
    'web/.next/cache/x',
    'src/.DS_Store',
    'src/App.tsx~',
    'src/.App.tsx.swp',
    'node_modules\\react\\index.js',
  ])
    assert.ok(isIgnored(rel), rel);
  for (const rel of [
    'src/App.tsx',
    'index.html',
    'public/build-info.json',
    'src/distance.ts',
  ])
    assert.ok(!isIgnored(rel), rel);
});

test('debounce runs once after the burst settles', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let calls = 0;
  const fire = debounce(() => calls++, 100);
  fire();
  vi.advanceTimersByTime(60);
  fire();
  vi.advanceTimersByTime(60);
  assert.equal(calls, 0);
  vi.advanceTimersByTime(40);
  assert.equal(calls, 1);
  fire();
  fire.cancel();
  vi.advanceTimersByTime(200);
  assert.equal(calls, 1);
});

test('watchTree reports one change per burst, with its start, and ignores node_modules', () => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'Date'],
    now: 1000,
  });
  const seen: number[] = [];
  let emit: (paths: ReadonlyArray<string>) => void = () => {};
  let isStopped = false;
  const stop = watchTree(
    '/repo',
    (since) => seen.push(since),
    (_root, onPaths) => ((emit = onPaths), () => (isStopped = true)),
  );
  emit(['node_modules/dep/index.js']);
  vi.advanceTimersByTime(DEBOUNCE_MS + 1);
  assert.equal(seen.length, 0);
  emit(['src/a.ts']);
  vi.advanceTimersByTime(50);
  emit(['src/b.ts']);
  vi.advanceTimersByTime(DEBOUNCE_MS + 1);
  assert.deepEqual(seen, [1000 + DEBOUNCE_MS + 1]);
  stop();
  assert.ok(isStopped);
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
  assert.deepEqual(memory.take('http://localhost:5173/a', 2000), {
    x: 0,
    y: 400,
  });
  assert.equal(memory.take('http://localhost:5173/a', 2000), null);
  assert.equal(memory.take('http://localhost:5173/b', 20_000), null);
  memory.remember('http://localhost:5173/c', { x: 0, y: 0 }, 1000);
  assert.equal(memory.take('http://localhost:5173/c', 1500), null);
});

test('devTarget prefers the dev script, then start, then other scripts, then launch.json', () => {
  const t = (
    name: string,
    source: 'package.json' | 'launch.json' = 'package.json',
  ) => ({ name, command: name, source });
  assert.equal(
    devTarget([
      t('web', 'launch.json'),
      t('electron:dev'),
      t('start'),
      t('dev'),
    ])?.name,
    'dev',
  );
  assert.equal(
    devTarget([t('web', 'launch.json'), t('electron:dev')])?.name,
    'electron:dev',
  );
  assert.equal(devTarget([]), null);
});
