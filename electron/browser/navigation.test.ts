import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canNavigate, isAllowedUrl } from './navigation.ts';

test('file: loads directly, but a web page cannot hop to one', () => {
  assert.equal(isAllowedUrl('file:///tmp/a.html'), true);
  assert.equal(isAllowedUrl('javascript:alert(1)'), false);
  assert.equal(canNavigate('https://evil.example/', 'FILE:///etc/passwd'), false);
  assert.equal(canNavigate('file:///tmp/a.html', 'file:///tmp/b.html'), true);
  assert.equal(canNavigate('file:///tmp/a.html', 'https://example.com/'), true);
});
