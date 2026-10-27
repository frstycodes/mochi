import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { UpdateState } from '@mochi/domain/host/types/updates';
import { channelOfVersion, nextState, type UpdaterEvent } from './state.ts';

const idle: UpdateState = {
  version: '0.2.0',
  channel: 'stable',
  status: 'idle',
};
const run = (events: UpdaterEvent[], from = idle) =>
  events.reduce(nextState, from);

test('channelOfVersion reads nightly only from the nightly prerelease tag', () => {
  assert.equal(channelOfVersion('0.3.0-nightly.20261027.42'), 'nightly');
  assert.equal(channelOfVersion('0.3.0'), 'stable');
  assert.equal(channelOfVersion('0.3.0-beta.1'), 'stable');
});

test('an update downloads to ready and later checks keep the prompt', () => {
  const ready = run([
    { type: 'checking' },
    { type: 'available', version: '0.3.0' },
    { type: 'progress', percent: 41.6 },
  ]);
  assert.deepEqual(ready, {
    ...idle,
    status: 'downloading',
    available: '0.3.0',
    percent: 42,
  });

  const downloaded = run(
    [{ type: 'downloaded', version: '0.3.0', at: 1 }],
    ready,
  );
  assert.deepEqual(downloaded, {
    ...idle,
    status: 'ready',
    available: '0.3.0',
    checkedAt: 1,
  });
  assert.equal(
    run(
      [{ type: 'checking' }, { type: 'error', message: 'offline', at: 2 }],
      downloaded,
    ),
    downloaded,
  );
});

test('an error clears progress, and switching channel resets to idle', () => {
  const failed = run([
    { type: 'available', version: '0.3.0' },
    { type: 'error', message: 'offline', at: 3 },
  ]);
  assert.deepEqual(failed, {
    ...idle,
    status: 'error',
    error: 'offline',
    checkedAt: 3,
  });
  assert.deepEqual(
    run([
      { type: 'downloaded', version: '0.3.0', at: 4 },
      { type: 'channel', channel: 'nightly' },
    ]),
    { ...idle, channel: 'nightly' },
  );
});
