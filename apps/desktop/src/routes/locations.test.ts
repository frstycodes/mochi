import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { remoteRouteOf, replayThreadOf, settingsRouteOf } from './locations.ts';

const at = (pathname: string, search: unknown = {}, state: object = {}) => ({
  pathname,
  search,
  state,
});

test('settings route reads section, deep link, subpage and nonce', () => {
  assert.deepEqual(
    settingsRouteOf(
      at('/settings/connectors', { setting: 'x', subpage: 42 }, { nonce: 3 }),
    ),
    { section: 'connectors', settingId: 'x', subpage: '42', nonce: 3 },
  );
  assert.equal(settingsRouteOf(at('/')), null);
  assert.equal(settingsRouteOf(at('/replay/t1')), null);
});

test('replay and remote routes are exclusive', () => {
  assert.equal(replayThreadOf(at('/replay/t%201')), 't 1');
  assert.equal(replayThreadOf(at('/settings/chat')), null);
  assert.deepEqual(remoteRouteOf(at('/remote/m1/t1')), {
    machineId: 'm1',
    threadId: 'm1~t1',
  });
  assert.equal(remoteRouteOf(at('/remote/m1')), null);
});
