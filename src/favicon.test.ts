import assert from 'node:assert/strict';
import { test } from 'node:test';
import { faviconFallback, faviconUrl } from './favicon.ts';
import { CONNECTORS, connectorIcon, GOOGLE_WORKSPACE_URL } from './library/connectors.ts';

test('custom connector icons start at the exact host and fall back once to domain.suffix', () => {
  for (const host of ['api.mobbin.com', 'mcp.mobbin.com', 'tools.api.mobbin.com', 'www.mobbin.com']) {
    const src = connectorIcon(`https://${host}/mcp`);
    assert.equal(src, faviconUrl(host, 64));
    const fallback = faviconFallback(src!);
    assert.equal(fallback, faviconUrl('mobbin.com', 64));
    assert.equal(faviconFallback(fallback!), null);
  }
  assert.equal(faviconFallback(faviconUrl('api.mobbin.com')), faviconUrl('mobbin.com'));
});

test('fallback keeps multi-part public suffixes whole', () => {
  assert.equal(faviconFallback(faviconUrl('mcp.example.co.uk')), faviconUrl('example.co.uk'));
  assert.equal(faviconFallback(faviconUrl('api.example.com.au')), faviconUrl('example.com.au'));
});

test('base domains, hosted subdomains, local addresses and direct images have no retry', () => {
  for (const host of ['mobbin.com', 'example.co.uk', 'my-mcp.vercel.app', 'localhost', '127.0.0.1', '[::1]']) assert.equal(faviconFallback(faviconUrl(host)), null);
  assert.equal(faviconFallback('https://example.com/icon.svg'), null);
  assert.equal(connectorIcon('invalid'), null);
});

test('known connectors retain their curated icons', () => {
  const hosts = [
    'notion.so',
    'slack.com',
    'linear.app',
    'github.com',
    'atlassian.com',
    'sentry.io',
    'vercel.com',
    'supabase.com',
    'cloudflare.com',
    'cloudflare.com',
    'figma.com',
    'stripe.com',
  ];
  assert.deepEqual(
    CONNECTORS.slice(1).map((connector) => connectorIcon(connector.serverUrl)),
    hosts.map((host) => faviconUrl(host, 64)),
  );
  assert.equal(connectorIcon(GOOGLE_WORKSPACE_URL), 'https://www.gstatic.com/images/branding/productlogos/googleg/v6/36px.svg');
});
