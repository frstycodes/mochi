import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { DEVICES, fitDevice } from './devices.ts';
import {
  EMPTY_HISTORY,
  history,
  isTooSmall,
  shapePath,
  type Shape,
} from './annotations.ts';
import { nextScrollSync } from './scrollSync.ts';
import { displayUrl, normalizeUrl, pushHistory, swapOrigin } from './url.ts';

test('normalizeUrl adds the right scheme or searches', () => {
  assert.equal(
    normalizeUrl('localhost:5173/admin'),
    'http://localhost:5173/admin',
  );
  assert.equal(normalizeUrl(':3000'), 'http://localhost:3000');
  assert.equal(normalizeUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(normalizeUrl('app.test'), 'http://app.test');
  assert.equal(normalizeUrl('example.com/docs'), 'https://example.com/docs');
  assert.equal(normalizeUrl('HTTPS://x.dev'), 'HTTPS://x.dev');
  assert.equal(normalizeUrl('  '), 'about:blank');
  assert.equal(normalizeUrl('file:///tmp/a.html'), 'file:///tmp/a.html');
  assert.equal(
    normalizeUrl('/Users/me/my site/index.html'),
    'file:///Users/me/my%20site/index.html',
  );
  assert.equal(
    normalizeUrl('react use effect'),
    'https://duckduckgo.com/?q=react%20use%20effect',
  );
  assert.equal(
    normalizeUrl('javascript:alert(1)'),
    'https://duckduckgo.com/?q=javascript%3Aalert(1)',
  );
  assert.equal(displayUrl('https://example.com/'), 'example.com');
});

test('pushHistory keeps the most recent first, once', () => {
  assert.deepEqual(pushHistory(['b', 'a'], 'a'), ['a', 'b']);
  assert.deepEqual(pushHistory(['a'], 'about:blank'), ['a']);
  assert.equal(
    pushHistory(
      Array.from({ length: 60 }, (_, i) => `u${i}`),
      'new',
    ).length,
    50,
  );
});

test('fitDevice centres, scales down only, and rotates', () => {
  const phone = DEVICES[0];
  const roomy = fitDevice({ width: 1000, height: 1000 }, phone, false);
  assert.equal(roomy.scale, 1);
  assert.deepEqual([roomy.x, roomy.width, roomy.cssWidth], [312.5, 375, 375]);
  const tight = fitDevice({ width: 400, height: 400 }, phone, false);
  assert.ok(tight.scale < 1 && tight.height <= 400 - 32 + 1e-9);
  const turned = fitDevice({ width: 1000, height: 1000 }, phone, true);
  assert.deepEqual([turned.cssWidth, turned.cssHeight], [667, 375]);
});

test('annotation history adds, undoes and redoes, and a new shape drops the redo stack', () => {
  const dot = (x: number): Shape => ({
    kind: 'box',
    color: 'red',
    size: 2,
    from: { x, y: 0 },
    to: { x: x + 10, y: 10 },
  });
  let h = history(history(EMPTY_HISTORY, { type: 'add', shape: dot(1) }), {
    type: 'add',
    shape: dot(2),
  });
  assert.equal(h.present.length, 2);
  h = history(h, { type: 'undo' });
  assert.deepEqual(h.present, [dot(1)]);
  assert.equal(history(h, { type: 'redo' }).present.length, 2);
  h = history(h, { type: 'add', shape: dot(3) });
  assert.equal(h.future.length, 0);
  assert.equal(history(EMPTY_HISTORY, { type: 'undo' }), EMPTY_HISTORY);
});

test('shapePath draws boxes closed and arrows with a head at the tip', () => {
  assert.equal(
    shapePath({
      kind: 'box',
      color: '',
      size: 2,
      from: { x: 1, y: 2 },
      to: { x: 5, y: 6 },
    }),
    'M1 2 H5 V6 H1 Z',
  );
  const arrow = shapePath({
    kind: 'arrow',
    color: '',
    size: 2,
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
  });
  assert.match(arrow, /^M0 0 L100 0 M91.3 -5 L100 0 L91.3 5$/);
  assert.ok(
    isTooSmall(
      {
        kind: 'arrow',
        color: '',
        size: 2,
        from: { x: 0, y: 0 },
        to: { x: 3, y: 0 },
      },
      1,
    ),
  );
  assert.ok(
    isTooSmall(
      { kind: 'note', color: '', size: 14, at: { x: 0, y: 0 }, text: '  ' },
      1,
    ),
  );
});

test('swapOrigin keeps the path on the base server', () => {
  assert.equal(
    swapOrigin(
      'http://localhost:5173/admin?tab=2#top',
      'http://localhost:5400',
    ),
    'http://localhost:5400/admin?tab=2#top',
  );
  assert.equal(
    swapOrigin('not a url', 'http://localhost:5400'),
    'http://localhost:5400',
  );
});

test('nextScrollSync follows whichever page moved', () => {
  assert.deepEqual(nextScrollSync(null, { x: 0, y: 40 }, { x: 0, y: 0 }), {
    move: 'b',
    to: { x: 0, y: 40 },
  });
  assert.deepEqual(
    nextScrollSync({ x: 0, y: 40 }, { x: 0, y: 40 }, { x: 0, y: 90 }),
    { move: 'a', to: { x: 0, y: 90 } },
  );
  assert.equal(
    nextScrollSync({ x: 0, y: 40 }, { x: 0, y: 40 }, { x: 0, y: 40.5 }),
    null,
  );
});
