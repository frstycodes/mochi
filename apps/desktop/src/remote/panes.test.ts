import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { remotePaneReason } from './panes.ts';

const machine = { name: 'Studio', scopes: ['read', 'code'] as const };
const inFolder = { repo: undefined, live: { cwd: '/owner/app' } } as never;

test('another computer’s thread opens the panes that run there, given their scope and a folder', () => {
  assert.equal(
    remotePaneReason(
      'files',
      { ...machine, scopes: [...machine.scopes] },
      inFolder,
    ),
    undefined,
  );
  assert.equal(
    remotePaneReason('agents', { ...machine, scopes: ['read'] }, inFolder),
    undefined,
  );
  assert.equal(
    remotePaneReason(
      'terminal',
      { ...machine, scopes: [...machine.scopes] },
      inFolder,
    ),
    'Studio hasn’t given this computer the terminal scope',
  );
  assert.equal(
    remotePaneReason('changes', { ...machine, scopes: [...machine.scopes] }, {
      repo: undefined,
      live: undefined,
    } as never),
    'This thread has no folder yet',
  );
  assert.equal(
    remotePaneReason(
      'browser',
      { ...machine, scopes: [...machine.scopes] },
      inFolder,
    ),
    'Do this on Studio itself for now',
  );
});
