import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  autoOrientation,
  buildPreset,
  closeLeaf,
  displayRoot,
  equalizeSplit,
  leaf,
  leaves,
  neighbourInDirection,
  rotateSplit,
  singleLayout,
  snapSizes,
  splitLeaf,
  splitTabIds,
  swapLeaves,
  zoneAt,
  type LayoutNode,
  type View,
} from './tree.ts';

const th = (id: string): View => ({ kind: 'thread', id });
const ids = (n: LayoutNode) => leaves(n).map((l) => (l.view.kind === 'thread' ? l.view.id : l.view.kind));
const shape = (n: LayoutNode): unknown => (n.kind === 'leaf' ? ids(n)[0] : { [n.dir]: n.children.map(shape) });

test('split nests across directions and flattens along the same one', () => {
  const a = leaf(th('a'));
  const right = splitLeaf(a, a.id, th('b'), 'right');
  assert.deepEqual(shape(right.root), { row: ['a', 'b'] });
  const again = splitLeaf(right.root, right.leafId, th('c'), 'right');
  assert.deepEqual(shape(again.root), { row: ['a', 'b', 'c'] });
  assert.deepEqual(again.root.kind === 'split' && again.root.sizes, [50, 25, 25]);
  const down = splitLeaf(again.root, a.id, th('d'), 'top');
  assert.deepEqual(shape(down.root), { row: [{ column: ['d', 'a'] }, 'b', 'c'] });
});

test('close collapses single-child splits and renormalizes sizes', () => {
  const a = leaf(th('a'));
  const { root, leafId } = splitLeaf(a, a.id, th('b'), 'right');
  assert.deepEqual(shape(closeLeaf(root, leafId)!), 'a');
  assert.equal(closeLeaf(a, a.id), null);
  const three = buildPreset('3-columns', [th('a'), th('b'), th('c')], 'row');
  const closed = closeLeaf(three, leaves(three)[0].id)!;
  assert.deepEqual(closed.kind === 'split' && closed.sizes, [50, 50]);
});

test('swap exchanges views, rotate flips one split, equalize resets sizes', () => {
  const tree = buildPreset('main-stack', [th('a'), th('b'), th('c')], 'row');
  const [x, , z] = leaves(tree);
  assert.deepEqual(ids(swapLeaves(tree, x.id, z.id)), ['c', 'b', 'a']);
  assert.deepEqual(shape(rotateSplit(tree, tree.id)), { column: ['a', { column: ['b', 'c'] }] });
  const eq = equalizeSplit(tree, tree.id);
  assert.deepEqual(eq.kind === 'split' && eq.sizes, [50, 50]);
});

test('auto orientation: portrait stacks, and an auto layout transposes for the other orientation', () => {
  assert.equal(autoOrientation(1600, 900), 'row');
  assert.equal(autoOrientation(900, 1400), 'column');
  const layout = { ...singleLayout(th('a')), root: buildPreset('2-up', [th('a'), th('b')], 'row') };
  assert.deepEqual(shape(displayRoot(layout, 'column')), { column: ['a', 'b'] });
  assert.deepEqual(shape(displayRoot({ ...layout, isAuto: false }, 'column')), { row: ['a', 'b'] });
});

test('2x2 preset is rows of two', () => {
  assert.deepEqual(shape(buildPreset('2x2', [th('a'), th('b'), th('c'), th('d')], 'row')), { column: [{ row: ['a', 'b'] }, { row: ['c', 'd'] }] });
});

test('snap catches thirds and half, leaves other sizes', () => {
  assert.deepEqual(snapSizes([48, 52]), [50, 50]);
  assert.deepEqual(snapSizes([35, 65]).map(Math.round), [33, 67]);
  assert.deepEqual(snapSizes([42, 58]), [42, 58]);
  assert.deepEqual(snapSizes([30, 30, 40]), [30, 30, 40]);
});

test('directional focus picks the nearest overlapping neighbour', () => {
  const rects = { a: { left: 0, top: 0, right: 50, bottom: 50 }, b: { left: 50, top: 0, right: 100, bottom: 50 }, c: { left: 0, top: 50, right: 100, bottom: 100 } };
  assert.equal(neighbourInDirection(rects, 'a', 'right'), 'b');
  assert.equal(neighbourInDirection(rects, 'b', 'bottom'), 'c');
  assert.equal(neighbourInDirection(rects, 'c', 'top'), 'a');
  assert.equal(neighbourInDirection(rects, 'a', 'left'), undefined);
});

test('drop zones: outer quarter per side, middle replaces', () => {
  const r = { left: 0, top: 0, right: 100, bottom: 100 };
  assert.equal(zoneAt(r, 10, 50), 'left');
  assert.equal(zoneAt(r, 50, 90), 'bottom');
  assert.equal(zoneAt(r, 50, 50), 'center');
});

test('drop zones without a centre: a pane tab always splits toward the nearest side', () => {
  const r = { left: 0, top: 0, right: 200, bottom: 100 };
  assert.equal(zoneAt(r, 100, 30, false), 'top');
  assert.equal(zoneAt(r, 60, 50, false), 'left');
  assert.equal(zoneAt(r, 140, 50, false), 'right');
  assert.equal(zoneAt(r, 100, 70, false), 'bottom');
  assert.equal(zoneAt(r, 60, 50), 'center');
  assert.equal(zoneAt(r, 10, 50, false), 'left');
});

test("split tab ids: only that thread's tabs, across every space", () => {
  const tab = (threadId: string, tabId: string): View => ({ kind: 'tab', threadId, tabId });
  const one = singleLayout(th('a'));
  const two = { ...one, root: splitLeaf(one.root, one.root.id, tab('a', 't1'), 'right').root };
  const other = { ...singleLayout(tab('a', 't2')) };
  const foreign = singleLayout(tab('b', 't3'));
  assert.deepEqual([...splitTabIds([two, other, foreign], 'a')].sort(), ['t1', 't2']);
});
