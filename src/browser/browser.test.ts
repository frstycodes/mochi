import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEVICES, fitDevice } from './devices.ts';
import { displayUrl, normalizeUrl, pushHistory } from './url.ts';

test('normalizeUrl adds the right scheme or searches', () => {
  assert.equal(normalizeUrl('localhost:5173/admin'), 'http://localhost:5173/admin');
  assert.equal(normalizeUrl(':3000'), 'http://localhost:3000');
  assert.equal(normalizeUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(normalizeUrl('app.test'), 'http://app.test');
  assert.equal(normalizeUrl('example.com/docs'), 'https://example.com/docs');
  assert.equal(normalizeUrl('HTTPS://x.dev'), 'HTTPS://x.dev');
  assert.equal(normalizeUrl('  '), 'about:blank');
  assert.equal(normalizeUrl('react use effect'), 'https://duckduckgo.com/?q=react%20use%20effect');
  assert.equal(normalizeUrl('javascript:alert(1)'), 'https://duckduckgo.com/?q=javascript%3Aalert(1)');
  assert.equal(displayUrl('https://example.com/'), 'example.com');
});

test('pushHistory keeps the most recent first, once', () => {
  assert.deepEqual(pushHistory(['b', 'a'], 'a'), ['a', 'b']);
  assert.deepEqual(pushHistory(['a'], 'about:blank'), ['a']);
  assert.equal(pushHistory(Array.from({ length: 60 }, (_, i) => `u${i}`), 'new').length, 50);
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
