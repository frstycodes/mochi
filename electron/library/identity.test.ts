import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { LibraryConnector } from '../../src/library/library.ts';
import { identityOf, sameAccount } from './identity.ts';

test('asks Slack and GitHub who signed in; other services say nothing', async () => {
  const slack = (async () =>
    Response.json({
      ok: true,
      team_id: 'T1',
      user_id: 'U1',
      team: 'Acme',
      user: 'sam',
    })) as typeof fetch;
  assert.deepEqual(
    await identityOf('https://mcp.slack.com/mcp', 'xoxp-1', slack),
    { id: 'slack/T1/U1', label: 'sam in Acme' },
  );
  const github = (async () =>
    Response.json({ id: 42, login: 'octo' })) as typeof fetch;
  assert.deepEqual(
    await identityOf('https://api.githubcopilot.com/mcp/', 'gho_1', github),
    { id: 'github/42', label: 'octo' },
  );
  assert.equal(
    await identityOf('https://mcp.linear.app/mcp', 't', slack),
    undefined,
  );
  assert.equal(
    await identityOf('https://mcp.slack.com/mcp', 'bad', (async () =>
      Response.json({ ok: false })) as typeof fetch),
    undefined,
  );
});

test('finds the account already connected as the same person on the same server', () => {
  const account = (
    id: string,
    alias: string,
    who?: string,
    key = 'slack',
  ): LibraryConnector => ({
    kind: 'connector',
    id,
    key,
    title: 'Slack',
    url: 'https://mcp.slack.com/mcp',
    alias,
    isLinked: true,
    targets: ['claude'],
    addedAt: 0,
    ...(who && { identity: { id: who, label: who } }),
  });
  const work = account('a', 'work', 'slack/T1/U1');
  const items = [
    work,
    account('b', 'other', 'slack/T2/U9'),
    account('c', 'gh', 'slack/T1/U1', 'github'),
  ];
  assert.equal(sameAccount(items, account('d', 'acme', 'slack/T1/U1')), work);
  assert.equal(
    sameAccount(items, account('e', 'new', 'slack/T3/U1')),
    undefined,
  );
  assert.equal(
    sameAccount(items, account('f', 'unknown')),
    undefined,
    'no identity, no guess',
  );
});
