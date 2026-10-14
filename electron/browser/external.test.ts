import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserLabel, parseSuggestions } from './external.ts';

test('browserLabel names the default browser on each platform', () => {
  assert.equal(browserLabel('Arc', 'Mochi'), 'Arc');
  assert.equal(browserLabel('Google Chrome.app', 'Mochi'), 'Google Chrome');
  assert.equal(browserLabel('chrome.exe', 'Mochi'), 'Chrome');
  assert.equal(browserLabel('org.mozilla.firefox.desktop', 'Mochi'), 'Firefox');
  assert.equal(browserLabel('google-chrome.desktop', 'Mochi'), 'Google Chrome');
  assert.equal(browserLabel('Microsoft Edge', 'Mochi'), 'Microsoft Edge');
});

test('browserLabel falls back to empty for nothing, Electron or the app itself', () => {
  assert.equal(browserLabel('', 'Mochi'), '');
  assert.equal(browserLabel('  ', 'Mochi'), '');
  assert.equal(browserLabel('Electron', 'Mochi'), '');
  assert.equal(browserLabel('Mochi.app', 'Mochi'), '');
});

test('parseSuggestions reads the OpenSearch shape and nothing else', () => {
  assert.deepEqual(parseSuggestions(['react', ['react', 'react native'], [], {}]), ['react', 'react native']);
  assert.deepEqual(parseSuggestions(['q', ['a', 2, '', 'b']]), ['a', 'b']);
  assert.equal(parseSuggestions(['q', Array.from({ length: 20 }, (_, i) => `s${i}`)]).length, 6);
  assert.deepEqual(parseSuggestions({ phrase: 'x' }), []);
  assert.deepEqual(parseSuggestions(null), []);
});
