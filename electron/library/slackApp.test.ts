import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSlackApp } from './slackApp.ts';

test('creates the Slack app from the manifest with MCP on and returns its credentials', async () => {
  let sent: URLSearchParams | undefined;
  const post = (async (_url: string, init: RequestInit) => {
    sent = init.body as URLSearchParams;
    return Response.json({ ok: true, app_id: 'A1', credentials: { client_id: '1.2', client_secret: 'abc' } });
  }) as typeof fetch;
  assert.deepEqual(await createSlackApp('xoxe.xoxp-1', 'https://relay.test/oauth/callback', post), { appId: 'A1', clientId: '1.2', clientSecret: 'abc' });
  assert.equal(sent!.get('token'), 'xoxe.xoxp-1');
  const manifest = JSON.parse(sent!.get('manifest')!);
  assert.equal(manifest.settings.is_mcp_enabled, true);
  assert.deepEqual(manifest.oauth_config.redirect_urls, ['https://relay.test/oauth/callback']);
});

test("says what Slack refused, so the agent falls back to the manifest link", async () => {
  const post = (async () => Response.json({ ok: false, error: 'invalid_manifest', errors: [{ message: 'unknown field', pointer: '/settings/is_mcp_enabled' }] })) as typeof fetch;
  await assert.rejects(createSlackApp('t', 'r', post), /invalid_manifest; \/settings\/is_mcp_enabled: unknown field/);
});
