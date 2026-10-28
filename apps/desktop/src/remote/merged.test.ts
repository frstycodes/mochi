import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Project } from '@mochi/domain/host/types/projects';
import type { Thread } from '../model.ts';
import { pinnedThreads, sidebarGroups } from '../reorder.ts';
import type { State } from '../store/types.ts';
import { remoteThreadId } from './ids.ts';
import {
  mergeThreads,
  pinAcross,
  projectMap,
  reorderAcross,
  splitByMachine,
} from './merged.ts';

const t = (id: string, extra: Partial<Thread> = {}) =>
  ({
    id,
    spaceId: 'personal',
    status: 'running',
    startedAt: 0,
    activity: [],
    repo: null,
    ...extra,
  }) as unknown as Thread;

const at = (lastAt: number) =>
  ({ activity: [{ at: lastAt }] }) as unknown as Partial<Thread>;
const mirror = (...threads: Thread[]) => ({
  state: { threads, spaceId: 'personal' } as unknown as State,
});
const lap = (id: string) => remoteThreadId('lap', id);

test('lists every computer’s threads together by last activity, in the profile with the same id or the current one', () => {
  const merged = mergeThreads(
    [t('a', at(10)), t('b', at(30))],
    [
      mirror(
        t(lap('new-1'), at(20)),
        t(lap('new-2'), { ...at(40), spaceId: 'theirs' }),
      ),
    ],
    [],
    ['personal', 'work'],
    'work',
  );
  const ids = (space: string) =>
    sidebarGroups(merged, space).active.map((g) => g.thread.id);
  assert.deepEqual(ids('personal'), ['b', lap('new-1'), 'a']);
  assert.deepEqual(ids('work'), [lap('new-2')]);
});

test('another computer’s own pins stay there; this screen’s pins sort with its own by key and take Orbit slots in that order', () => {
  const merged = mergeThreads(
    [
      t('a', { orbitSlot: 1, pinOrder: 100 }),
      t('b', { orbitSlot: 2, pinOrder: 300 }),
    ],
    [
      mirror(
        t(lap('pinned-there'), { orbitSlot: 1, pinOrder: 50 }),
        t(lap('pinned-here')),
      ),
    ],
    [{ id: lap('pinned-here'), order: 200 }],
    ['personal'],
    'personal',
  );
  assert.deepEqual(
    pinnedThreads(merged, 'personal').map((x) => [x.id, x.orbitSlot]),
    [
      ['a', 1],
      [lap('pinned-here'), 2],
      ['b', 3],
    ],
  );
  assert.equal(
    merged.find((x) => x.id === lap('pinned-there'))?.orbitSlot,
    undefined,
  );
});

test('a pin past the last Orbit slot isn’t pinned here', () => {
  const local = [1, 2, 3, 5, 7].map((slot, i) =>
    t(`l${i}`, { orbitSlot: slot, pinOrder: i }),
  );
  const merged = mergeThreads(
    local,
    [mirror(t(lap('late')))],
    [{ id: lap('late'), order: 99 }],
    ['personal'],
    'personal',
  );
  const late = merged.find((x) => x.id === lap('late'))!;
  assert.equal(late.orbitSlot, undefined);
  assert.equal(late.pinOrder, undefined);
});

test('another computer’s project shows as this computer’s clone of the same origin', () => {
  const project = (path: string, origin: string | null) =>
    ({ id: path, name: path.split('/').pop(), path, origin }) as Project;
  const map = projectMap(
    [
      project('/Users/them/code/mochi', 'github.com/x/mochi'),
      project('/Users/them/solo', null),
    ],
    [project('/Users/me/src/mochi', 'github.com/x/mochi')],
  );
  const merged = mergeThreads(
    [],
    [
      {
        ...mirror(
          t(lap('1'), {
            repo: {
              project: 'mochi',
              branch: 'b',
              path: '/Users/them/code/mochi',
            },
          }),
          t(lap('2'), {
            repo: { project: 'solo', branch: 'b', path: '/Users/them/solo' },
          }),
        ),
        projects: map,
      },
    ],
    [],
    ['personal'],
    'personal',
  );
  assert.deepEqual(
    merged.map((x) => x.repo?.path),
    ['/Users/me/src/mochi', '/Users/them/solo'],
  );
});

test('a reorder across computers: this one’s threads by its own actions with the merged keys, the other’s into this screen’s pins', () => {
  const merged = mergeThreads(
    [t('a', { orbitSlot: 1, pinOrder: 100 }), t('b')],
    [mirror(t(lap('r')), t(lap('gone')))],
    [
      { id: lap('gone'), order: 150 },
      { id: remoteThreadId('desk', 'x'), order: 1 },
    ],
    ['personal'],
    'personal',
  );
  const out = reorderAcross(
    merged,
    {
      type: 'reorder',
      pinned: ['a', lap('r'), 'b'],
      unpinned: [lap('gone')],
      at: 5000,
    },
    [
      { id: lap('gone'), order: 150 },
      { id: remoteThreadId('desk', 'x'), order: 1 },
    ],
  )!;
  assert.deepEqual(out.local, [
    { type: 'reorder', pinned: ['a', 'b'], unpinned: [], at: 5000 },
    { type: 'pin-at', threadId: 'a', order: 100 },
    { type: 'pin-at', threadId: 'b', order: 5001 },
  ]);
  assert.deepEqual(out.pins, [
    { id: remoteThreadId('desk', 'x'), order: 1 },
    { id: lap('r'), order: 5000 },
  ]);
});

test('pinning another computer’s thread at a key; refused when Pinned is full', () => {
  const merged = mergeThreads(
    [t('a', { orbitSlot: 1, pinOrder: 100 })],
    [mirror(t(lap('r')))],
    [],
    ['personal'],
    'personal',
  );
  assert.deepEqual(pinAcross(merged, lap('r'), 50, []), [
    { id: lap('r'), order: 50 },
  ]);
  const full = mergeThreads(
    [1, 2, 3, 5, 7].map((slot, i) =>
      t(`l${i}`, { orbitSlot: slot, pinOrder: i }),
    ),
    [mirror(t(lap('r')))],
    [],
    ['personal'],
    'personal',
  );
  assert.equal(pinAcross(full, lap('r'), 50, []), null);
});

test('actions go to the computer whose threads they name; a bulk delete splits per computer', () => {
  assert.deepEqual(
    splitByMachine({ type: 'rename', threadId: lap('1'), title: 'x' }),
    [
      {
        machineId: 'lap',
        action: { type: 'rename', threadId: lap('1'), title: 'x' },
      },
    ],
  );
  assert.deepEqual(
    splitByMachine({ type: 'go', view: { kind: 'thread', id: lap('1') } }).map(
      (s) => s.machineId,
    ),
    ['lap'],
  );
  assert.deepEqual(
    splitByMachine({ type: 'go', view: { kind: 'new' } }).map(
      (s) => s.machineId,
    ),
    [null],
  );
  assert.deepEqual(
    splitByMachine({ type: 'delete', threadIds: ['a', lap('1'), lap('2')] }),
    [
      { machineId: null, action: { type: 'delete', threadIds: ['a'] } },
      {
        machineId: 'lap',
        action: { type: 'delete', threadIds: [lap('1'), lap('2')] },
      },
    ],
  );
});
