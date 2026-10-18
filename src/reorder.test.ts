import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Thread } from './model.ts';
import { activeThreads, dropAt, dropPin, nestBlocker, parentOf, pinMany, sidebarGroups, pinnedThreads, reorderThreads, stepPin, togglePin } from './reorder.ts';

const t = (id: string, orbitSlot?: number, lastAt = 0) => ({ id, orbitSlot, spaceId: 's', status: 'running', startedAt: 0, activity: lastAt ? [{ at: lastAt }] : [] }) as unknown as Thread;

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
  assert.deepEqual(pinMany(threads, 's', ['c', 'b']), { pinned: ['a', 'c', 'b'], unpinned: ['d'] });
  const pinned = [t('a', 1), t('b', 2), t('c', 3), t('d')];
  assert.deepEqual(pinMany(pinned, 's', ['a', 'c']), { pinned: ['b'], unpinned: ['c', 'a', 'd'] });
  const full = [t('a', 1), t('b', 2), t('c', 3), t('d', 4), t('e'), t('f'), t('g')];
  assert.equal(pinMany(full, 's', ['e', 'f']), null);
});

test('unpinned threads list most recent activity first; pinned keep their slot order', () => {
  const threads = [t('old', undefined, 10), t('p2', 2, 5), t('new', undefined, 30), t('mid', undefined, 20), t('p1', 1, 1)];
  assert.deepEqual(activeThreads(threads, 's').map((x) => x.id), ['new', 'mid', 'old']);
});

test('a sub-thread nests under a live parent in its space and stands alone once that parent settles', () => {
  const parent = t('p');
  const child = { ...t('c'), parent: { threadId: 'p' } } as Thread;
  assert.equal(parentOf([parent, child], child)?.id, 'p');
  assert.equal(parentOf([{ ...parent, status: 'settled' } as Thread, child], child), undefined);
  assert.equal(parentOf([{ ...parent, spaceId: 'other' } as Thread, child], child), undefined);
});

test('nesting is one level deep and never under itself', () => {
  const threads = [t('p'), { ...t('c'), parent: { threadId: 'p' } } as Thread, t('x')];
  assert.equal(nestBlocker(threads, 'x', 'p'), null);
  assert.equal(nestBlocker(threads, 'x', 'x'), 'Not a thread to nest under');
  assert.equal(nestBlocker(threads, 'x', 'c'), 'Sub-threads nest one level deep');
  assert.equal(nestBlocker(threads, 'p', 'x'), 'It has sub-threads of its own');
});

test('the sidebar nests open sub-threads under their parent, pinned or not, and only counts settled ones', () => {
  const threads = [t('p', 1), { ...t('a', undefined, 9), startedAt: 2, parent: { threadId: 'p' } }, { ...t('b', undefined, 1), startedAt: 1, parent: { threadId: 'p' } }, { ...t('done'), status: 'settled', parent: { threadId: 'p' } }, t('x')] as Thread[];
  const { pinned, active } = sidebarGroups(threads, 's');
  assert.deepEqual(pinned.map((g) => [g.thread.id, g.subs.map((s) => s.id), g.settledSubs]), [['p', ['b', 'a'], 1]]);
  assert.deepEqual(active.map((g) => g.thread.id), ['x'], 'a sub-thread is never a row of its own while its parent is live');
});

test('a drag reorders on the edges of a row and nests in its middle; a sub-thread moves out only by leaving its group', () => {
  const rows = [
    { id: 'p', top: 0, height: 40, isPinned: true },
    { id: 'a', top: 60, height: 40, isPinned: false },
    { id: 'c', top: 100, height: 30, isPinned: false, parentId: 'a' },
    { id: 'b', top: 140, height: 40, isPinned: false },
  ];
  const yes = () => true;
  assert.deepEqual(dropAt(rows, 50, { id: 'b' }, 64, false, yes), { slot: { toPinned: false, index: 0 }, nestUnder: null }, 'top quarter of a: before it');
  assert.deepEqual(dropAt(rows, 50, { id: 'b' }, 80, false, yes), { slot: null, nestUnder: 'a' }, 'middle of a: nest');
  assert.deepEqual(dropAt(rows, 50, { id: 'b' }, 85, false, () => false), { slot: { toPinned: false, index: 1 }, nestUnder: null }, 'a row that cannot take it only reorders');
  assert.deepEqual(dropAt(rows, 50, { id: 'b' }, 10, true, yes), { slot: null, nestUnder: 'p' }, 'pinned rows take sub-threads too');
  assert.deepEqual(dropAt(rows, 50, { id: 'c', parentId: 'a' }, 115, false, yes), { slot: null, nestUnder: null }, 'within its own group: stays');
  assert.deepEqual(dropAt(rows, 50, { id: 'c', parentId: 'a' }, 175, false, yes), { slot: { toPinned: false, index: 2 }, nestUnder: null }, 'below b: out, after it');
  assert.deepEqual(dropAt(rows, 50, { id: 'b' }, 45, false, yes), { slot: { toPinned: true, index: 1 }, nestUnder: null }, 'above the label: pinned, as before');
});
