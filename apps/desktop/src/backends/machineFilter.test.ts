import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Thread } from '../model.ts';
import { mergeThreads } from '../remote/merged.ts';
import { remoteThreadId } from '../remote/ids.ts';
import type { State } from '../store/types.ts';
import {
  filteredWindowRoute,
  idsFromHash,
  narrowToMachines,
  resolveMachineFilter,
  toggleMachine,
} from './machineFilter.ts';
import { LOCAL_BACKEND } from './registry.ts';

const t = (id: string) =>
  ({
    id,
    spaceId: 'personal',
    status: 'running',
    startedAt: 0,
    activity: [],
    repo: null,
  }) as unknown as Thread;
const q = (threadId: string) => ({ id: `q-${threadId}`, threadId });
const ALL = [LOCAL_BACKEND, 'studio', 'server'];

const remote = (machineId: string, ...ids: string[]) => ({
  state: {
    threads: ids.map((id) => t(remoteThreadId(machineId, id))),
    queue: ids.map((id) => q(remoteThreadId(machineId, id))),
    spaceId: 'personal',
  } as unknown as State,
});

const merged = () => {
  const sources = [remote('studio', 's1', 's2'), remote('server', 'v1')];
  const threads = mergeThreads(
    [t('l1')],
    sources,
    [],
    ['personal'],
    'personal',
  );
  const queue = [q('l1'), ...sources.flatMap((s) => s.state.queue)];
  return { threads, queue } as unknown as State;
};
const ids = (s: State) => s.threads.map((x) => x.id).sort();

test('no filter lists every machine', () => {
  const all = merged();
  assert.equal(narrowToMachines(all, []), all);
});

test('the filter narrows the merged threads and Queue to its machines', () => {
  const studio = narrowToMachines(merged(), ['studio']);
  assert.deepEqual(ids(studio), ['studio~s1', 'studio~s2'].sort());
  assert.deepEqual(
    studio.queue.map((x) => x.threadId),
    ['studio~s1', 'studio~s2'],
  );

  const here = narrowToMachines(merged(), [LOCAL_BACKEND, 'server']);
  assert.deepEqual(ids(here), ['l1', 'server~v1']);
  assert.deepEqual(
    here.queue.map((x) => x.threadId),
    ['l1', 'server~v1'],
  );
});

test('a filter naming no paired machine, or all of them, shows all', () => {
  assert.deepEqual(resolveMachineFilter(['gone'], ALL), []);
  assert.deepEqual(resolveMachineFilter(ALL, ALL), []);
  assert.deepEqual(resolveMachineFilter(['studio', 'gone'], ALL), ['studio']);
});

test('toggling hides one, keeps the last, and all again clears it', () => {
  assert.deepEqual(toggleMachine([], 'server', ALL), [LOCAL_BACKEND, 'studio']);
  assert.deepEqual(toggleMachine(['studio'], 'studio', ALL), ['studio']);
  assert.deepEqual(toggleMachine(['studio', 'server'], LOCAL_BACKEND, ALL), []);
});

test('a new window starts with the filter its route carries', () => {
  const route = filteredWindowRoute([LOCAL_BACKEND, 'studio']);
  assert.deepEqual(idsFromHash(`#/${route}`), [LOCAL_BACKEND, 'studio']);
  assert.deepEqual(idsFromHash('#/'), []);
});
