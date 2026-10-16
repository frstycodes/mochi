import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Thread } from './model.ts';
import { activeThreads, dropPin, orderBetween, pinAt, pinMany, pinnedThreads, pinOrderOf, reorderThreads, stepPin, togglePin } from './reorder.ts';

const t = (id: string, orbitSlot?: number, lastAt = 0) => ({ id, orbitSlot, spaceId: 's', status: 'running', startedAt: 0, activity: lastAt ? [{ at: lastAt }] : [] }) as unknown as Thread;

test('reorders listed threads in place and assigns pin slots in order', () => {
  const threads = [t('a', 1), t('other'), t('b'), t('c', 2)];
  const out = reorderThreads(threads, ['c', 'b'], ['a'], 1000);
  assert.deepEqual(
    out.map((x) => [x.id, x.orbitSlot]),
    [['c', 1], ['other', undefined], ['b', 2], ['a', undefined]],
  );
});

test('refuses more pins than Orbit has slots', () => {
  const threads = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => t(id));
  assert.equal(reorderThreads(threads, ['a', 'b', 'c', 'd', 'e', 'f'], [], 1000), threads);
});

test('pinned order follows Orbit slots, not array order', () => {
  assert.deepEqual(pinnedThreads([t('a', 3), t('b'), t('c', 1)], 's').map((x) => x.id), ['c', 'a']);
});

test('toggle pin appends to Pinned, unpin goes to the top of Threads, full Pinned refuses', () => {
  const threads = [t('a', 1), t('b'), t('c')];
  assert.deepEqual(togglePin(threads, 's', 'b'), { pinned: ['a', 'b'], unpinned: ['c'] });
  assert.deepEqual(togglePin(threads, 's', 'a'), { pinned: [], unpinned: ['a', 'b', 'c'] });
  const full = [1, 2, 3, 5, 7].map((slot, i) => t(`p${i}`, slot));
  assert.equal(togglePin([...full, t('x')], 's', 'x'), null);
});

test('Alt arrows swap within Pinned and cross the boundary at its edge; an unpinned thread pins on up from anywhere', () => {
  assert.deepEqual(stepPin(['a', 'b'], ['c'], 'b', -1), { pinned: ['b', 'a'], unpinned: ['c'] });
  assert.deepEqual(stepPin(['a', 'b'], ['c'], 'b', 1), { pinned: ['a'], unpinned: ['b', 'c'] });
  assert.deepEqual(stepPin(['a'], ['c', 'd'], 'c', -1), { pinned: ['a', 'c'], unpinned: ['d'] });
  assert.equal(stepPin(['a'], ['c'], 'a', -1), null);
  assert.deepEqual(stepPin(['a'], ['c', 'd'], 'd', -1), { pinned: ['a', 'd'], unpinned: ['c'] });
  assert.equal(stepPin(['a'], ['c', 'd'], 'c', 1), null, 'unpinned threads have no manual order to step through');
});

test('drop inserts at the index of the target list', () => {
  assert.deepEqual(dropPin(['a'], ['b', 'c'], 'c', true, 0), { pinned: ['c', 'a'], unpinned: ['b'] });
  assert.deepEqual(dropPin(['a', 'b'], ['c'], 'a', false, 1), { pinned: ['b'], unpinned: ['c', 'a'] });
  assert.equal(dropPin(['a', 'b', 'c', 'd', 'e'], ['f'], 'f', true, 2), null);
});

test('bulk pin appends in selection order; bulk unpin puts them back at the top of Threads; overflow refuses all', () => {
  const threads = [t('a', 1), t('b'), t('c'), t('d')];
  assert.deepEqual(pinMany(threads, 's', ['c', 'b'], 1000), { pinned: ['a', 'c', 'b'], unpinned: ['d'] });
  const pinned = [t('a', 1), t('b', 2), t('c', 3), t('d')];
  assert.deepEqual(pinMany(pinned, 's', ['a', 'c'], 1000), { pinned: ['b'], unpinned: ['c', 'a', 'd'] });
  const full = [t('a', 1), t('b', 2), t('c', 3), t('d', 4), t('e'), t('f'), t('g')];
  assert.equal(pinMany(full, 's', ['e', 'f'], 1000), null);
});

test('unpinned threads list most recent activity first; pinned keep their slot order', () => {
  const threads = [t('old', undefined, 10), t('p2', 2, 5), t('new', undefined, 30), t('mid', undefined, 20), t('p1', 1, 1)];
  assert.deepEqual(activeThreads(threads, 's').map((x) => x.id), ['new', 'mid', 'old']);
});

const keyed = (id: string, orbitSlot: number, pinOrder: number) => ({ ...t(id, orbitSlot), pinOrder }) as Thread;

test('a reorder keeps pin keys where it can, so pins stay put among another computer’s; a new pin at the end goes last everywhere', () => {
  const threads = [keyed('a', 1, 100), keyed('b', 2, 200), t('c')];
  const appended = reorderThreads(threads, ['a', 'b', 'c'], [], 5000);
  assert.deepEqual(appended.map((x) => x.pinOrder), [100, 200, 5000]);
  const swapped = reorderThreads(threads, ['b', 'a'], ['c'], 5000);
  assert.deepEqual(swapped.map((x) => [x.id, x.orbitSlot, x.pinOrder]), [['b', 1, 200], ['a', 2, 201], ['c', undefined, undefined]], 'only the moved pin’s key changes, just past its neighbour');
  const first = reorderThreads(threads, ['c', 'a', 'b'], [], 5000);
  assert.deepEqual(first.map((x) => [x.id, x.pinOrder]), [['c', 99], ['a', 100], ['b', 200]], 'a new pin dropped first sorts before the old first');
  assert.equal(pinOrderOf(t('legacy', 3)), 3, 'a pin from before keys sorts by its Orbit slot');
});

test('a pin moved between two of any computers’ pins takes the key between them; Orbit slots follow key order here', () => {
  assert.equal(orderBetween(100, 200), 150);
  assert.equal(orderBetween(200, undefined, 5000), 5000);
  assert.equal(orderBetween(undefined, 100), 99);
  const threads = [keyed('a', 1, 100), keyed('b', 2, 200), t('c')];
  const moved = pinAt(threads, 's', 'b', 50)!;
  assert.deepEqual(moved.map((x) => [x.id, x.orbitSlot, x.pinOrder]), [['a', 2, 100], ['b', 1, 50], ['c', undefined, undefined]]);
  const added = pinAt(threads, 's', 'c', 150)!;
  assert.deepEqual(added.map((x) => [x.id, x.orbitSlot]), [['a', 1], ['b', 3], ['c', 2]]);
  const full = [1, 2, 3, 5, 7].map((slot, i) => keyed(`p${i}`, slot, slot * 10));
  assert.equal(pinAt([...full, t('x')], 's', 'x', 1), null);
});
