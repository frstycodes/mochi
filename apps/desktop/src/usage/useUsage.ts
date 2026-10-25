import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useWorktreePaths } from '../git/worktrees.ts';
import { host } from '../host/index.ts';
import { useProjects } from '../projects.ts';
import { useSpace, useSpaceThreads } from '../store/index.tsx';
import {
  rangeStart,
  usageView,
  type RangeId,
  type UsageTarget,
} from './report.ts';
import { queryKeys } from '../queryKeys.ts';
import type { Project } from '@mochi/domain/host/types/projects';
import type { Thread } from '../model.ts';

/** Usage over `range` for `target`; reads logs and repos again when the range, the projects or the reach (everywhere) change. */
export function useUsage(range: RangeId, target: UsageTarget) {
  const space = useSpace();
  const threads = useSpaceThreads();
  const projects = useProjects(space.id, threads);
  const worktrees = useWorktreePaths();
  const [now, setNow] = useState(Date.now);

  const isEverywhere = target.kind === 'everywhere';
  const query =
    projects && usageScope(projects, threads, worktrees, isEverywhere);

  const reportQuery = useQuery({
    queryKey: queryKeys.usage.report(
      range,
      space.id,
      space.github,
      query?.roots,
      query?.repos,
      now,
    ),
    queryFn: () =>
      host.usage.report({
        roots: query!.roots,
        repos: query!.repos,
        since: rangeStart(range, now),
        githubUser: space.github || undefined,
      }),
    enabled: !!query,
    placeholderData: keepPreviousData,
  });
  const report = reportQuery.data ?? null;
  const view =
    report && query
      ? usageView(report, { range, now, projectOf: query.projectOf, target })
      : null;
  return {
    projects: projects ?? [],
    view,
    errors: report?.errors ?? [],
    error: reportQuery.error?.message ?? null,
    isLoading: reportQuery.isFetching,
    refresh: () => setNow(Date.now()),
  };
}

function usageScope(
  projects: Project[],
  threads: readonly Thread[],
  worktrees: Record<string, string>,
  isEverywhere: boolean,
) {
  const projectOf = new Map(projects.map((p) => [p.path, p.id]));
  for (const t of threads) {
    const project = t.repo?.path && projectOf.get(t.repo.path);
    const worktree = worktrees[t.id];
    if (project && worktree) projectOf.set(worktree, project);
  }
  // Everywhere adds `/`, which takes every session the projects don't; only then is the whole log folder read.
  const roots = [...projectOf.keys(), ...(isEverywhere ? ['/'] : [])];
  return {
    projectOf,
    roots,
    repos: projects.filter((p) => !p.isMissing).map((p) => p.path),
  };
}
