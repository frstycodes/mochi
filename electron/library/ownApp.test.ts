import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slackClientFrom, type SlackApps } from './ownApp.ts';

function apps(known: Record<string, { clientId: string; clientSecret: string }> = {}) {
  const made: string[] = [];
  const store: SlackApps = {
    read: async (key) => known[key],
    save: async (key, client) => void (known[key] = client),
    create: async (token) => (made.push(token), { clientId: 'new.1', clientSecret: 'n'.repeat(32) }),
  };
  return { store, known, made };
}

test('never makes a second Slack app for a workspace: captured beats remembered beats new, and each is kept', async () => {
  const fresh = apps();
  assert.deepEqual(await slackClientFrom({ values: { slackConfigToken: 'xoxe-1' }, params: { workspace: 'Acme' } }, fresh.store), { clientId: 'new.1', clientSecret: 'n'.repeat(32) });
  assert.deepEqual(fresh.made, ['xoxe-1']);
  assert.ok(fresh.known['app:slack:acme'], 'kept for next time');
  assert.deepEqual(await slackClientFrom({ values: { slackConfigToken: 'xoxe-2' }, params: { workspace: 'ACME' } }, fresh.store), fresh.known['app:slack:acme']);
  assert.deepEqual(fresh.made, ['xoxe-1'], 'the remembered app, no new one');
  const found = apps({ 'app:slack:acme': { clientId: 'old.1', clientSecret: 'o'.repeat(32) } });
  assert.deepEqual(await slackClientFrom({ values: { slackConfigToken: 'xoxe-3', slackClientId: 'live.1', slackClientSecret: 'l'.repeat(32) }, params: { workspace: 'Acme' } }, found.store), { clientId: 'live.1', clientSecret: 'l'.repeat(32) });
  assert.equal(found.known['app:slack:acme'].clientId, 'live.1', 'the one found on the page replaces what was remembered');
  await assert.rejects(slackClientFrom({ values: {}, params: {} }, apps().store), /no Slack app or token/);
});
