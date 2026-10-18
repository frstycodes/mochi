import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mochiOAuthApp, mochiOAuthProviders } from './oauthApps.ts';

test("Mochi's own OAuth apps come from the build, overridable per provider by env", () => {
  const baked = mochiOAuthApp('slack');
  process.env.MOCHI_OAUTH_SLACK_CLIENT_ID = 'slack-id';
  process.env.MOCHI_OAUTH_SLACK_CLIENT_SECRET = 'slack-secret';
  assert.deepEqual(mochiOAuthApp('slack'), { client_id: 'slack-id', client_secret: 'slack-secret' });
  process.env.MOCHI_OAUTH_SLACK_CLIENT_SECRET = '';
  assert.deepEqual(mochiOAuthApp('slack'), { client_id: 'slack-id' });
  assert.ok(mochiOAuthProviders().includes('slack'));
  delete process.env.MOCHI_OAUTH_SLACK_CLIENT_ID;
  delete process.env.MOCHI_OAUTH_SLACK_CLIENT_SECRET;
  assert.deepEqual(mochiOAuthApp('slack'), baked);
});
