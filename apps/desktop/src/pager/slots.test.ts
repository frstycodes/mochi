import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { OFF_PIN, pagerSlots, pinnedNeighbour, slotsOf } from './slots.ts';
import type { Thread } from '../model.ts';
import { remoteThreadId } from '../remote/ids.ts';
import { mergeThreads } from '../remote/merged.ts';
import type { State } from '../store/types.ts';

const PINS = ['a', 'b', 'c', 'd', 'e'];

test('pins keep pin order and the focused one sits at its own position', () => {
  assert.deepEqual(pagerSlots(PINS, ['c'], 'c'), { ids: PINS, center: 2 });
});

test('other threads in the focused split group leave the pager', () => {
  assert.deepEqual(pagerSlots(PINS, ['c', 'a', 'x'], 'c'), {
    ids: ['b', 'c', 'd', 'e'],
    center: 1,
  });
});

test('an unpinned view sits before the first pin', () => {
  assert.deepEqual(pagerSlots(PINS, ['x'], 'x'), {
    ids: [OFF_PIN, ...PINS],
    center: 0,
  });
  assert.deepEqual(pagerSlots(PINS, [], undefined), {
    ids: [OFF_PIN, ...PINS],
    center: 0,
  });
});

test('neighbours are pins only; the ends have none', () => {
  assert.equal(pinnedNeighbour({ ids: PINS, center: 2 }, 1), 'd');
  assert.equal(pinnedNeighbour({ ids: PINS, center: 0 }, -1), undefined);
  assert.equal(
    pinnedNeighbour({ ids: [OFF_PIN, ...PINS], center: 1 }, -1),
    undefined,
  );
});

// Another computer's pins sit among this one's in the pager, as the sidebar lists them.
const thread = (id: string, extra: Partial<Thread> = {}) =>
  ({
    id,
    spaceId: 'personal',
    status: 'running',
    startedAt: 0,
    activity: [],
    repo: null,
    ...extra,
  }) as unknown as Thread;

test('a pin on another computer’s thread takes its place among the pager’s pages', () => {
  const lap = (id: string) => remoteThreadId('lap', id);
  const merged = mergeThreads(
    [thread('a', { pinOrder: 10 }), thread('z', { pinOrder: 30 })],
    [
      {
        state: {
          threads: [thread(lap('r')), thread(lap('s'))],
        } as unknown as State,
      },
    ],
    [{ id: lap('r'), order: 20 }],
    ['personal'],
    'personal',
  );
  const state = {
    spaceId: 'personal',
    layouts: {
      personal: {
        focusId: 'x',
        root: { kind: 'leaf', id: 'x', view: { kind: 'thread', id: lap('r') } },
      },
    },
  } as unknown as State;
  const slots = slotsOf(state, merged);
  assert.deepEqual(slots, { ids: ['a', lap('r'), 'z'], center: 1 });
  assert.equal(pinnedNeighbour(slots, -1), 'a');
  assert.equal(pinnedNeighbour(slots, 1), 'z');
  const keyOf = (id: string) => merged.find((t) => t.id === id)?.pinOrder;
  assert.deepEqual(['a', lap('r'), 'z'].map(keyOf), [10, 20, 30]);
  assert.equal(keyOf(lap('s')), undefined);
  // Without the merge the local-only list leaves the remote pin out.
  assert.deepEqual(slotsOf(state, [merged[0], merged[1]]).ids, [
    OFF_PIN,
    'a',
    'z',
  ]);
});
