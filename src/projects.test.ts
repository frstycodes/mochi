import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { host } from './host/index.ts';
import type { Project } from './host/types/projects.ts';
import { QueryObserver } from '@tanstack/react-query';
import { projectsQueryOptions, refreshProjects } from './projects.ts';
import { queryClient } from './query.ts';
import { queryKeys } from './queryKeys.ts';

test('only the first read migrates, so the change main announces for it settles on a list instead of looping', async () => {
  const calls: string[] = [];
  const original = { ...host.projects };
  host.projects.migrate = async (spaceId) => {
    calls.push('migrate');
    await Promise.resolve();
    // Capped so a regression fails the assertion below instead of hanging the run.
    if (calls.length < 10) refreshProjects(spaceId);
    return [];
  };
  host.projects.list = async () => {
    calls.push('list');
    return [] as Project[];
  };
  const queryKey = queryKeys.projects.list('loop-check');
  let onIdle = () => {};
  // Called while a fetch is in flight: the next notification with nothing fetching comes after it finished.
  const settled = () => new Promise<void>((resolve) => (onIdle = resolve));
  const stop = new QueryObserver(
    queryClient,
    projectsQueryOptions('loop-check', []),
  ).subscribe(() => {
    if (queryClient.isFetching({ queryKey }) === 0) onIdle();
  });
  try {
    await settled();
    refreshProjects('loop-check');
    await settled();
    assert.deepEqual(
      calls.filter((c) => c === 'migrate'),
      ['migrate'],
    );
    assert.ok(calls.length <= 3, `settled after ${calls.join(', ')}`);
  } finally {
    stop();
    Object.assign(host.projects, original);
    queryClient.clear();
  }
});
