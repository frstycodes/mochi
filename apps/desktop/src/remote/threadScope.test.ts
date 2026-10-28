import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Action, State } from '../store';
import {
  hybridState,
  isQuietAction,
  isScreenAction,
  localSlices,
} from './threadScope.ts';

const local = {
  threads: [{ id: 'mine' }],
  queue: [{ id: 'q-mine' }],
  checkpoints: { mine: [] },
  panes: [{ threadId: 'm1~t' }],
  spaceId: 'personal',
  sidechats: { mine: {} },
  now: 2,
} as unknown as State;
const mirror = {
  threads: [{ id: 'm1~t' }],
  queue: [{ id: 'm1~q' }],
  checkpoints: { 'm1~t': [] },
  panes: [{ threadId: 'theirs' }],
  spaceId: 'their-space',
  sidechats: { theirs: {} },
  now: 1,
} as unknown as State;

test('another computer’s thread view: its threads, queue and checkpoints, this window’s panes, space and side chats', () => {
  const state = hybridState(localSlices(local), mirror);
  assert.equal(state.threads, mirror.threads);
  assert.equal(state.queue, mirror.queue);
  assert.equal(state.checkpoints, mirror.checkpoints);
  assert.equal(state.panes, local.panes);
  assert.equal(state.spaceId, 'personal');
  assert.equal(state.sidechats, local.sidechats);
  assert.equal(state.now, 2, 'this computer’s clock');
  assert.equal('threads' in localSlices(local), false);
});

test('screen actions stay here; thread actions don’t', () => {
  const here: Action[] = [
    { type: 'pane-toggle', threadId: 'm1~t' },
    { type: 'pane-show-tab', threadId: 'm1~t', kind: 'changes' },
    { type: 'go', view: { kind: 'thread', id: 'm1~t' } },
    { type: 'layout-close' },
    { type: 'sidechat-open', threadId: 'm1~t' },
    { type: 'overview-toggle' },
    { type: 'watch-toggle', threadId: 'm1~t' },
  ];
  for (const action of here) assert.ok(isScreenAction(action), action.type);
  const there: Action[] = [
    { type: 'rename', threadId: 'm1~t', title: 'x' },
    { type: 'interrupt', threadId: 'm1~t' },
    { type: 'queued-remove', threadId: 'm1~t', id: 'q' },
    { type: 'delete', threadIds: ['m1~t'] },
  ];
  for (const action of there) assert.ok(!isScreenAction(action), action.type);
  assert.ok(
    isQuietAction({
      type: 'next-move-record',
    } as unknown as Action),
  );
});
