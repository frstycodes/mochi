import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { extendSelection, selectRange, toggleSelected } from './selection.ts';

const order = ['a', 'b', 'c', 'd', 'e'];

test('shift-click selects from the anchor to the clicked row in list order, either direction', () => {
  assert.deepEqual(selectRange(order, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(selectRange(order, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(selectRange(order, 'c', 'c'), ['c']);
});

test('shift-click with no anchor, or an anchor no longer listed, selects just the row', () => {
  assert.deepEqual(selectRange(order, undefined, 'c'), ['c']);
  assert.deepEqual(selectRange(order, 'gone', 'c'), ['c']);
  assert.deepEqual(selectRange(order, 'a', 'gone'), []);
});

test('mod-click starts from the open thread, adds and removes, keeps list order and moves the anchor', () => {
  const one = toggleSelected(order, { ids: [], anchor: 'c' }, 'a');
  assert.deepEqual(one, { ids: ['a', 'c'], anchor: 'a' });
  assert.deepEqual(toggleSelected(order, one, 'c').ids, ['a']);
  assert.deepEqual(
    toggleSelected(order, { ids: [], anchor: undefined }, 'b').ids,
    ['b'],
  );
});

test('shift arrows grow and shrink the range around the anchor and stop at the ends', () => {
  const down = extendSelection(order, { ids: [], anchor: 'b' }, 'b', 1)!;
  assert.deepEqual(down, {
    selection: { ids: ['b', 'c'], anchor: 'b' },
    focusId: 'c',
  });
  const back = extendSelection(order, down.selection, 'c', -1)!;
  assert.deepEqual(back.selection.ids, ['b']);
  const up = extendSelection(order, back.selection, 'b', -1)!;
  assert.deepEqual(up.selection.ids, ['a', 'b']);
  assert.equal(extendSelection(order, up.selection, 'a', -1), null);
});
