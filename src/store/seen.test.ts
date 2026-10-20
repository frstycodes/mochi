import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Thread } from '../model.ts';
import { isUnread } from './seen.ts';

const thread = (isWorking: boolean, seenActivity: number) => ({ activity: [{}, {}], seenActivity, live: { isWorking } }) as unknown as Thread;

test('a working thread is not unread until its turn ends', () => {
  assert.equal(isUnread(thread(true, 0)), false);
  assert.equal(isUnread(thread(false, 0)), true);
  assert.equal(isUnread(thread(false, 2)), false);
});
