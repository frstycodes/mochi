import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leaves, singleLayout, splitLeaf, type View } from '../layout/tree.ts';
import type { Thread } from '../model.ts';
import type { State } from './index.tsx';
import { layoutReducer } from './layout.ts';

const th = (id: string): View => ({ kind: 'thread', id });
const thread = (id: string, orbitSlot?: number, status: Thread['status'] = 'running') => ({ id, spaceId: 's', orbitSlot, status }) as Thread;

function start(views: View[], threads: Thread[]) {
  let layout = singleLayout(views[0]);
  for (const view of views.slice(1)) layout = { ...layout, root: splitLeaf(layout.root, layout.focusId, view, 'right').root };
  return { spaceId: 's', views: { s: views[0] }, layouts: { s: layout }, orientation: 'row', watched: [], threads } as unknown as State;
}
const settle = (s: State, id: string) => {
  const threads = s.threads.map((t) => (t.id === id ? { ...t, status: 'settled' as const } : t));
  return layoutReducer({ ...s, threads }, { type: 'settle', threadId: id });
};
const shown = (s: State) => leaves(s.layouts.s.root).map((l) => (l.view.kind === 'thread' ? l.view.id : l.view.kind));

test('settling the thread in view moves to the first pinned thread, skipping the one settled', () => {
  const s = settle(start([th('a')], [thread('a', 1), thread('b', 3), thread('c', 2), thread('d')]), 'a');
  assert.deepEqual(shown(s), ['c']);
  assert.deepEqual(s.views.s, th('c'));
});

test('with no other pinned thread it moves to a new thread', () => {
  const s = settle(start([th('a')], [thread('a', 1), thread('d'), thread('e', 2, 'settled')]), 'a');
  assert.deepEqual(shown(s), ['new']);
});

test('a split showing the settled thread skips pins already on screen; other splits stay', () => {
  const s = settle(start([th('b'), th('a')], [thread('a'), thread('b', 1), thread('c', 2)]), 'a');
  assert.deepEqual(shown(s), ['b', 'c']);
});

test('settling a thread not in view changes nothing', () => {
  const before = start([th('a')], [thread('a', 1), thread('b', 2)]);
  const s = settle(before, 'b');
  assert.equal(s.layouts, before.layouts);
});
