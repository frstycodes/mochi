import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { leaves, singleLayout, type View } from '../layout/tree.ts';
import type { Action, State } from './index.tsx';
import { layoutReducer } from './layout.ts';

const th = (id: string): View => ({ kind: 'thread', id });
const threadIds = (s: State) =>
  leaves(s.layouts.s.root).map((l) =>
    l.view.kind === 'thread' ? l.view.id : l.view.kind,
  );

function start(view: View = th('a')) {
  const layout = singleLayout(view);
  return {
    spaceId: 's',
    views: { s: view },
    layouts: { s: layout },
    orientation: 'row',
    watched: [],
    threads: [
      { id: 'a', spaceId: 's' },
      { id: 'b', spaceId: 's' },
    ],
  } as unknown as State;
}
const run = (s: State, ...actions: Action[]) =>
  actions.reduce(layoutReducer, s);

test('split opens beside the focused split, focuses it, and mirrors the view', () => {
  const s = run(start(), { type: 'layout-split', view: th('b') });
  assert.deepEqual(threadIds(s), ['a', 'b']);
  assert.deepEqual(s.views.s, th('b'));
});

test('going to a view already open focuses that split instead of opening it twice', () => {
  const s = run(
    start(),
    { type: 'layout-split', view: th('b') },
    { type: 'layout-focus-step', step: 1 },
    { type: 'go', view: th('b') },
  );
  assert.deepEqual(threadIds(s), ['a', 'b']);
  assert.deepEqual(s.views.s, th('b'));
});

test('dropping an open thread on an edge moves it; in the centre it swaps', () => {
  const two = run(start(), { type: 'layout-split', view: th('b') });
  const [a] = leaves(two.layouts.s.root);
  const moved = run(two, {
    type: 'layout-drop',
    leafId: a.id,
    zone: 'top',
    view: th('b'),
  });
  assert.deepEqual(threadIds(moved), ['b', 'a']);
  assert.equal(
    moved.layouts.s.root.kind === 'split' && moved.layouts.s.root.dir,
    'column',
  );
  const swapped = run(two, {
    type: 'layout-drop',
    leafId: a.id,
    zone: 'center',
    view: th('b'),
  });
  assert.deepEqual(threadIds(swapped), ['b', 'a']);
});

test('a thread you start or fork opens in the focused split; one an agent starts in the background does not', () => {
  // The thread slice ran first: the new thread holds the sequence number before the current one.
  const created = {
    ...start(),
    seq: 4,
    threads: [
      ...start().threads,
      { id: 'new-3', spaceId: 's' },
      { id: 'fork-3', spaceId: 's' },
    ],
  } as unknown as State;
  const create: Action = {
    type: 'create',
    title: 't',
    provider: 'claude',
    project: null,
  };
  assert.deepEqual(threadIds(run(created, create)), ['new-3']);
  assert.deepEqual(threadIds(run(created, { ...create, isBackground: true })), [
    'a',
  ]);
  assert.deepEqual(
    threadIds(
      run(created, {
        type: 'fork',
        threadId: 'a',
        point: { kind: 'message', index: 0 },
      }),
    ),
    ['fork-3'],
  );
  assert.deepEqual(
    threadIds(run({ ...created, threads: start().threads } as State, create)),
    ['a'],
    'nothing opens when no thread was made',
  );
});

test('a view written by another slice lands in the focused split', () => {
  const s = run({ ...start(), views: { s: th('b') } }, {
    type: 'pause',
  } as Action);
  assert.deepEqual(threadIds(s), ['b']);
});

test('close refuses the last split and moves focus to a neighbour', () => {
  const one = start();
  assert.equal(run(one, { type: 'layout-close' }).layouts.s, one.layouts.s);
  const s = run(
    one,
    { type: 'layout-split', view: th('b') },
    { type: 'layout-close' },
  );
  assert.deepEqual(threadIds(s), ['a']);
  assert.deepEqual(s.views.s, th('a'));
});

test('splitting with a thread already on screen focuses it instead', () => {
  const two = run(start(), { type: 'layout-split', view: th('b') });
  const again = run(
    two,
    { type: 'layout-focus-step', step: 1 },
    { type: 'layout-split', view: th('b') },
  );
  assert.deepEqual(threadIds(again), ['a', 'b']);
  assert.deepEqual(again.views.s, th('b'));
});

test('a pane tab dropped on an edge opens beside; returning it closes its split, or shows its thread when it was the only one', () => {
  const tab: View = { kind: 'tab', threadId: 'a', tabId: 't1' };
  const one = start();
  const [a] = leaves(one.layouts.s.root);
  const dropped = run(one, {
    type: 'layout-drop',
    leafId: a.id,
    zone: 'right',
    view: tab,
  });
  assert.deepEqual(threadIds(dropped), ['a', 'tab']);
  assert.deepEqual(dropped.views.s, tab);
  const back = run(dropped, {
    type: 'layout-return-tab',
    threadId: 'a',
    tabId: 't1',
  });
  assert.deepEqual(threadIds(back), ['a']);
  assert.deepEqual(back.views.s, th('a'));
  const alone = run(start(tab), {
    type: 'layout-return-tab',
    threadId: 'a',
    tabId: 't1',
  });
  assert.deepEqual(threadIds(alone), ['a']);
  assert.equal(
    run(back, { type: 'layout-return-tab', threadId: 'a', tabId: 't1' })
      .layouts,
    back.layouts,
  );
});
