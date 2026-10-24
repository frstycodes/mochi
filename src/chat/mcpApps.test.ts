import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { withCsp } from './mcpApps.ts';

const MOBBIN = '<!doctype html><html><head>\n<script type="module" src="https://mobbin.com/a.js"></script></head><body><header>x</header></body></html>';

test('the CSP goes first in <head> and allows only the declared domains', () => {
  const html = withCsp(MOBBIN, { resourceDomains: ['https://bytescale.mobbin.com', 'https://mobbin.com'] });
  const policy = /content="([^"]+)"/.exec(html)![1];
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'before any script');
  assert.match(policy, /script-src 'unsafe-inline' https:\/\/bytescale\.mobbin\.com https:\/\/mobbin\.com/);
  assert.match(policy, /connect-src 'none'/, 'no connectDomains: no fetch');
  assert.match(policy, /frame-src 'none'/);
});

test('a <header> is not a <head>, and HTML without <head> gets the policy up front', () => {
  assert.ok(withCsp('<header>x</header>').startsWith('<meta http-equiv="Content-Security-Policy"'));
});

test('a domain that could break out of the policy or the attribute is dropped', () => {
  const html = withCsp('<head></head>', { connectDomains: ['https://ok.example', "https://x.example; script-src *", '"><script>'] });
  const policy = /content="([^"]+)"/.exec(html)![1];
  assert.match(policy, /connect-src https:\/\/ok\.example;/);
  assert.doesNotMatch(policy, /x\.example|<script>/);
});
