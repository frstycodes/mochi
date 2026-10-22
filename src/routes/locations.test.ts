import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isReviewLocation, remoteRouteOf, replayThreadOf, settingsRouteOf } from './locations.ts';

const at = (pathname: string, search: unknown = {}, state: object = {}) => ({ pathname, search, state });

test('settings route reads section, deep link, subpage and nonce', () => {
  assert.deepEqual(settingsRouteOf(at('/settings/connectors', { setting: 'x', subpage: 42 }, { nonce: 3 })), { section: 'connectors', settingId: 'x', subpage: '42', nonce: 3 });
  assert.equal(settingsRouteOf(at('/')), null);
  assert.equal(settingsRouteOf(at('/replay/t1')), null);
});

test('replay, remote and review routes are exclusive', () => {
  assert.equal(replayThreadOf(at('/replay/t%201')), 't 1');
  assert.equal(replayThreadOf(at('/settings/chat')), null);
  assert.deepEqual(remoteRouteOf(at('/remote/m1/t1')), { machineId: 'm1', threadId: 't1' });
  assert.equal(remoteRouteOf(at('/remote/m1')), null);
  assert.equal(isReviewLocation(at('/review')), true);
  assert.equal(isReviewLocation(at('/')), false);
});
