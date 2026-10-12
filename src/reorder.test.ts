import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Thread } from './model.ts';
import { dropPin, pinMany, pinnedThreads, reorderThreads, stepPin, togglePin } from './reorder.ts';

const t = (id: string, orbitSlot?: number) => ({ id, orbitSlot, spaceId: 's', status: 'running' }) as Thread;

test('reorders listed threads in place and assigns pin slots in order', () => {
  const threads = [t('a', 1), t('other'), t('b'), t('c', 2)];
  const out = reorderThreads(threads, ['c', 'b'], ['a']);
  assert.deepEqual(
    out.map((x) => [x.id, x.orbitSlot]),
    [['c', 1], ['other', undefined], ['b', 2], ['a', undefined]],
  );
});

test('refuses more pins than Orbit has slots', () => {
  const threads = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => t(id));
  assert.equal(reorderThreads(threads, ['a', 'b', 'c', 'd', 'e', 'f'], []), threads);
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

test('Alt arrows swap within a list and cross the Pinned boundary at its edge', () => {
  assert.deepEqual(stepPin(['a', 'b'], ['c'], 'b', -1), { pinned: ['b', 'a'], unpinned: ['c'] });
  assert.deepEqual(stepPin(['a', 'b'], ['c'], 'b', 1), { pinned: ['a'], unpinned: ['b', 'c'] });
  assert.deepEqual(stepPin(['a'], ['c', 'd'], 'c', -1), { pinned: ['a', 'c'], unpinned: ['d'] });
  assert.equal(stepPin(['a'], ['c'], 'a', -1), null);
});

test('drop inserts at the index of the target list', () => {
  assert.deepEqual(dropPin(['a'], ['b', 'c'], 'c', true, 0), { pinned: ['c', 'a'], unpinned: ['b'] });
  assert.deepEqual(dropPin(['a', 'b'], ['c'], 'a', false, 1), { pinned: ['b'], unpinned: ['c', 'a'] });
  assert.equal(dropPin(['a', 'b', 'c', 'd', 'e'], ['f'], 'f', true, 2), null);
});

test('bulk pin appends in selection order; bulk unpin puts them back at the top of Threads; overflow refuses all', () => {
  const threads = [t('a', 1), t('b'), t('c'), t('d')];
  assert.deepEqual(pinMany(threads, 's', ['c', 'b']), { pinned: ['a', 'c', 'b'], unpinned: ['d'] });
  const pinned = [t('a', 1), t('b', 2), t('c', 3), t('d')];
  assert.deepEqual(pinMany(pinned, 's', ['a', 'c']), { pinned: ['b'], unpinned: ['c', 'a', 'd'] });
  const full = [t('a', 1), t('b', 2), t('c', 3), t('d', 4), t('e'), t('f'), t('g')];
  assert.equal(pinMany(full, 's', ['e', 'f']), null);
});
