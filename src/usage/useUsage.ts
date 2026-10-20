import { useEffect, useMemo, useState } from 'react';
import { useWorktreePaths } from '../git/worktrees.ts';
import { host } from '../host/index.ts';
import type { UsageReport } from '../host/types/usage.ts';
import { useProjects } from '../projects.ts';
import { useSpace, useSpaceThreads } from '../store/index.tsx';
import { rangeStart, usageView, type RangeId } from './report.ts';

/** The profile's usage over `range`, for one project or all; reads logs and repos again when the range or the projects change. */
export function useUsage(range: RangeId, projectId: string | null) {
  const space = useSpace();
  const threads = useSpaceThreads();
  const projects = useProjects(space.id, threads);
  const worktrees = useWorktreePaths();
  const [result, setResult] = useState<{ key: string; report: UsageReport } | { key: string; error: string } | null>(null);
  const [now, setNow] = useState(Date.now);

  const query = useMemo(() => {
    if (!projects) return null;
    const projectOf = new Map(projects.map((p) => [p.path, p.id]));
    for (const t of threads) {
      const project = t.repo?.path && projectOf.get(t.repo.path);
      const worktree = worktrees[t.id];
      if (project && worktree) projectOf.set(worktree, project);
    }
    return { projectOf, roots: [...projectOf.keys()], repos: projects.filter((p) => !p.isMissing).map((p) => p.path) };
  }, [projects, threads, worktrees]);

  const key = query ? `${range}\u0000${space.id}\u0000${query.roots.join('\u0000')}\u0000${now}` : null;
  useEffect(() => {
    if (!query || !key) return;
    let isCurrent = true;
    host.usage
      .report({ roots: query.roots, repos: query.repos, since: rangeStart(range, now), githubUser: space.github || undefined })
      .then((report) => isCurrent && setResult({ key, report }))
      .catch((error: Error) => isCurrent && setResult({ key, error: error.message }));
    return () => {
      isCurrent = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // The last report stays up while the next range loads, so switching ranges doesn't flash an empty page.
  const report = result && 'report' in result ? result.report : null;
  const view = useMemo(() => (report && query ? usageView(report, { range, now, projectOf: query.projectOf, projectId }) : null), [report, query, range, now, projectId]);
  return {
    projects: projects ?? [],
    view,
    errors: report?.errors ?? [],
    error: result && 'error' in result ? result.error : null,
    isLoading: result?.key !== key,
    refresh: () => setNow(Date.now()),
  };
}
