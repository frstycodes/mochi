import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Thread } from './model.ts';
import {
  filteredSidebarLists,
  NO_PROJECT,
  projectFilterOptions,
  resolveFilter,
} from './projectFilter.ts';

const t = (
  id: string,
  project: string | null,
  extra: Partial<Thread> = {},
): Thread =>
  ({
    id,
    spaceId: 's',
    status: 'running',
    startedAt: 0,
    activity: [],
    repo: project
      ? { project, branch: 'main', path: `/code/${project}` }
      : null,
    ...extra,
  }) as unknown as Thread;

test('options list each project once, the latest started first', () => {
  const threads = [
    t('a', 'api', { startedAt: 1 }),
    t('b', 'web', { startedAt: 5 }),
    t('c', 'api', { startedAt: 3 }),
    t('d', null, { startedAt: 9 }),
  ];
  assert.deepEqual(
    projectFilterOptions(threads).map((o) => o.ref),
    ['/code/web', '/code/api'],
  );
});

test('a saved project no thread uses any more reads as all projects', () => {
  const options = projectFilterOptions([t('a', 'api')]);
  assert.equal(resolveFilter('/code/api', options, false), '/code/api');
  assert.equal(resolveFilter('/code/gone', options, false), null);
  assert.equal(resolveFilter(NO_PROJECT, options, false), null);
  assert.equal(resolveFilter(NO_PROJECT, options, true), NO_PROJECT);
});

test('the filter narrows pinned, active and archived alike, groups by their top thread', () => {
  const threads = [
    t('pin-api', 'api', { orbitSlot: 1 }),
    t('pin-web', 'web', { orbitSlot: 2 }),
    t('api', 'api'),
    t('sub', 'web', { parent: { threadId: 'api' } } as Partial<Thread>),
    t('web', 'web'),
    t('chat', null),
    t('old-api', 'api', { status: 'settled' }),
    t('old-web', 'web', { status: 'settled' }),
  ];
  const ids = (filter: string | null) => {
    const { pinned, active, settled } = filteredSidebarLists(
      threads,
      's',
      filter,
    );
    return {
      pinned: pinned.map((g) => g.thread.id),
      active: active.map((g) => [g.thread.id, ...g.subs.map((s) => s.id)]),
      settled: settled.map((s) => s.id),
    };
  };
  assert.deepEqual(ids('/code/api'), {
    pinned: ['pin-api'],
    active: [['api', 'sub']],
    settled: ['old-api'],
  });
  assert.deepEqual(ids(NO_PROJECT), {
    pinned: [],
    active: [['chat']],
    settled: [],
  });
  assert.equal(ids(null).active.length, 3);
  assert.equal(ids(null).settled.length, 2);
});

test('archived stays latest archived first after filtering', () => {
  const settled = (id: string, project: string, settledAt: number) =>
    t(id, project, { status: 'settled', settledAt });
  const threads = [
    settled('old', 'api', 1),
    settled('web', 'web', 5),
    settled('new', 'api', 9),
    settled('mid', 'api', 4),
  ];
  assert.deepEqual(
    filteredSidebarLists(threads, 's', '/code/api').settled.map((s) => s.id),
    ['new', 'mid', 'old'],
  );
});
