import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { isWebUrl, linkTarget } from './linkTarget.ts';

const click = (
  button: number,
  keys: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {},
) => ({
  button,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...keys,
});

test('a plain click opens the side pane on every platform', () => {
  assert.equal(linkTarget(click(0), true), 'pane');
  assert.equal(linkTarget(click(0), false), 'pane');
});

test('⌘-click on macOS and Ctrl-click elsewhere open the system browser', () => {
  assert.equal(linkTarget(click(0, { metaKey: true }), true), 'external');
  assert.equal(linkTarget(click(0, { ctrlKey: true }), false), 'external');
});

test("the other platform's modifier stays a plain click", () => {
  assert.equal(linkTarget(click(0, { ctrlKey: true }), true), 'pane');
  assert.equal(linkTarget(click(0, { metaKey: true }), false), 'pane');
});

test('a middle click opens the system browser, other buttons do nothing', () => {
  assert.equal(linkTarget(click(1), true), 'external');
  assert.equal(linkTarget(click(1), false), 'external');
  assert.equal(linkTarget(click(2), true), null);
  assert.equal(linkTarget(click(3), false), null);
});

test('only http(s) URLs count as web links', () => {
  assert.ok(isWebUrl('https://example.com'));
  assert.ok(isWebUrl('HTTP://example.com/a'));
  assert.ok(!isWebUrl('mailto:a@b.c'));
  assert.ok(!isWebUrl('file:///tmp/a'));
  assert.ok(!isWebUrl('src/a.ts'));
});
