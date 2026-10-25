import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Thread } from './model.ts';
import { initialThreads } from './store/threads.ts';
import { activeThreads, descendantsOf, isSameListing, lastActivityAt, dropAt, dropPin, flattenGroups, nestBlocker, rootOf, orderBetween, parentOf, pinAt, pinMany, pinnedThreads, pinOrderOf, reorderThreads, sidebarGroups, stepPin, togglePin } from './reorder.ts';

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

test('a sub-thread nests under a live parent in its space and stands alone once that parent settles', () => {
  const parent = t('p');
  const child = { ...t('c'), parent: { threadId: 'p' } } as Thread;
  assert.equal(parentOf([parent, child], child)?.id, 'p');
  assert.equal(parentOf([{ ...parent, status: 'settled' } as Thread, child], child), undefined);
  assert.equal(parentOf([{ ...parent, spaceId: 'other' } as Thread, child], child), undefined);
});

test('nesting goes any depth but never under itself or its own subtree', () => {
  const threads = [t('p'), { ...t('c'), parent: { threadId: 'p' } } as Thread, { ...t('g'), parent: { threadId: 'c' } } as Thread, t('x')];
  assert.equal(nestBlocker(threads, 'x', 'p'), null);
  assert.equal(nestBlocker(threads, 'x', 'c'), null, 'under a sub-thread');
  assert.equal(nestBlocker(threads, 'x', 'g'), null, 'under a sub-sub-thread');
  assert.equal(nestBlocker(threads, 'p', 'x'), null, 'a parent nests with its tree');
  assert.equal(nestBlocker(threads, 'x', 'x'), 'Not a thread to nest under');
  assert.equal(nestBlocker(threads, 'p', 'c'), 'It is one of its own sub-threads');
  assert.equal(nestBlocker(threads, 'p', 'g'), 'It is one of its own sub-threads', 'a cycle two levels down');
  assert.deepEqual(descendantsOf(threads, 'p').map((d) => d.id), ['c', 'g']);
});

test('a two-level tree shows one level deep: the whole open subtree under its top-level row, depth first, settled ones counted at any level', () => {
  const threads = [
    t('p'),
    { ...t('a'), startedAt: 1, parent: { threadId: 'p' } },
    { ...t('a1'), startedAt: 3, parent: { threadId: 'a' } },
    { ...t('a2'), status: 'settled', parent: { threadId: 'a' } },
    { ...t('b'), startedAt: 2, parent: { threadId: 'p' } },
    t('x'),
  ] as Thread[];
  const { active } = sidebarGroups(threads, 's');
  assert.deepEqual(active.map((g) => [g.thread.id, g.subs.map((s) => s.id)]), [['p', ['a', 'a1', 'b']], ['x', []]]);
  assert.deepEqual(flattenGroups(active).map((x) => x.id), ['p', 'a', 'a1', 'b', 'x']);
  assert.equal(rootOf(threads, threads[2]).id, 'p', 'a grandchild shows in its top-level row’s group');
  assert.deepEqual(threads[2].parent, { threadId: 'a' }, 'while its parent stays the thread that started it');
});

test('the sidebar nests open sub-threads under their parent, pinned or not, and only counts settled ones', () => {
  const threads = [t('p', 1), { ...t('a', undefined, 9), startedAt: 2, parent: { threadId: 'p' } }, { ...t('b', undefined, 1), startedAt: 1, parent: { threadId: 'p' } }, { ...t('done'), status: 'settled', parent: { threadId: 'p' } }, t('x')] as Thread[];
  const { pinned, active } = sidebarGroups(threads, 's');
  assert.deepEqual(pinned.map((g) => [g.thread.id, g.subs.map((s) => s.id)]), [['p', ['b', 'a']]]);
  assert.deepEqual(active.map((g) => g.thread.id), ['x'], 'a sub-thread is never a row of its own while its parent is live');
});

test('a drag reorders by height and nests, indented, under the row above the line; a sub-thread moves out only by leaving its group', () => {
  const rows = [
    { id: 'p', top: 0, height: 40, isPinned: true },
    { id: 'a', top: 60, height: 40, isPinned: false },
    { id: 'c', top: 100, height: 30, isPinned: false, parentId: 'a' },
    { id: 'b', top: 140, height: 40, isPinned: false },
  ];
  const yes = () => true;
  assert.deepEqual(dropAt(rows, 50, { id: 'b' }, 64, false, false, yes), { slot: { toPinned: false, index: 0 }, nestUnder: null }, 'top half of a: before it');
  assert.deepEqual(dropAt(rows, 50, { id: 'b' }, 85, false, false, yes), { slot: { toPinned: false, index: 1 }, nestUnder: null }, 'past the middle of a, not indented: after it');
  assert.deepEqual(dropAt(rows, 50, { id: 'b' }, 85, true, false, yes), { slot: { toPinned: false, index: 1 }, nestUnder: 'a' }, 'indented: under a, the row above the line');
  assert.deepEqual(dropAt(rows, 50, { id: 'b' }, 120, true, false, yes), { slot: { toPinned: false, index: 1 }, nestUnder: 'a' }, "among a's sub-threads: still under a");
  assert.deepEqual(dropAt(rows, 50, { id: 'b' }, 64, true, false, yes), { slot: { toPinned: false, index: 0 }, nestUnder: null }, 'indented with no row above in its section: reorders only');
  assert.deepEqual(dropAt(rows, 50, { id: 'b' }, 85, true, false, () => false), { slot: { toPinned: false, index: 1 }, nestUnder: null }, 'a row that cannot take it only reorders');
  assert.deepEqual(dropAt(rows, 50, { id: 'b' }, 30, true, false, yes), { slot: { toPinned: true, index: 1 }, nestUnder: 'p' }, 'pinned rows take sub-threads too');
  assert.deepEqual(dropAt(rows, 50, { id: 'c', parentId: 'a' }, 115, false, false, yes), { slot: null, nestUnder: null }, 'within its own group: stays');
  assert.deepEqual(dropAt(rows, 50, { id: 'c', parentId: 'a' }, 135, true, false, yes), { slot: null, nestUnder: null }, 'indented right under its own parent: stays');
  assert.deepEqual(dropAt(rows, 50, { id: 'c', parentId: 'a' }, 175, false, false, yes), { slot: { toPinned: false, index: 2 }, nestUnder: null }, 'below b: out, after it');
  assert.deepEqual(dropAt(rows, 50, { id: 'b' }, 45, false, false, yes), { slot: { toPinned: true, index: 1 }, nestUnder: null }, 'above the label: pinned, as before');
  assert.deepEqual(dropAt(rows, 50, { id: 'b' }, 45, false, true, yes), { slot: { toPinned: false, index: 0 }, nestUnder: null }, 'Pinned full: stays in Threads');
});

test('a grandchild stays put anywhere in its group, and a refused parent only reorders', () => {
  // The sidebar shows c (under p) and g (under c) one level deep, both rows of p's group.
  const rows = [
    { id: 'p', top: 0, height: 40, isPinned: false },
    { id: 'c', top: 40, height: 40, isPinned: false, parentId: 'p' },
    { id: 'g', top: 80, height: 40, isPinned: false, parentId: 'p' },
    { id: 'x', top: 120, height: 40, isPinned: false },
  ];
  const yes = () => true;
  assert.deepEqual(dropAt(rows, -10, { id: 'x' }, 100, true, false, yes), { slot: { toPinned: false, index: 1 }, nestUnder: 'p' }, "indented among p's group: under p");
  assert.deepEqual(dropAt(rows, -10, { id: 'x' }, 100, true, false, (id) => id !== 'p'), { slot: { toPinned: false, index: 1 }, nestUnder: null }, 'refused (a cycle): only reorders');
  assert.deepEqual(dropAt(rows, -10, { id: 'g', parentId: 'p' }, 70, true, false, yes), { slot: null, nestUnder: null }, 'over its own group: stays');
  assert.deepEqual(dropAt(rows, -10, { id: 'g', parentId: 'p' }, 155, false, false, yes), { slot: { toPinned: false, index: 2 }, nestUnder: null }, 'past the group: out');
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

test('a listing stays the same through streamed text, and changes with its order, a title or a new activity time', () => {
  const [a, b] = initialThreads().threads;
  const streamed = { ...a, activity: [...a.activity.slice(0, -1), { ...a.activity.at(-1)!, text: 'more' }] };
  assert.ok(isSameListing([a, b], [streamed, b]));
  assert.ok(!isSameListing([a, b], [b, a]));
  assert.ok(!isSameListing([a, b], [{ ...a, title: 'Renamed' }, b]));
  assert.ok(!isSameListing([a, b], [{ ...a, activity: [...a.activity, { ...a.activity.at(-1)!, at: lastActivityAt(a) + 1 }] }, b]));
});
