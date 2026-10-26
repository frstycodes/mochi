import { useStore } from 'zustand';
import { persistedFamily } from './lib/uiStorage.ts';
import type { Thread } from './model.ts';
import { projectRef } from './projectRef.ts';
import { projectUsage } from './projects.ts';
import { settledThreads, sidebarGroups } from './reorder.ts';

/** The sidebar's project filter: a project ref, NO_PROJECT for folderless chats, null for all projects. */
export type ProjectFilter = string | null;

export const NO_PROJECT = ':no-project';

export type ProjectFilterOption = { ref: string; name: string; path?: string };

const filterSlice = persistedFamily<ProjectFilter>(
  'mochi.sidebar.project-filter.',
  null,
);

/** The profile's sidebar project filter, remembered per profile; a project no thread uses any more reads as all projects. */
export function useProjectFilter(spaceId: string, threads: readonly Thread[]) {
  const slice = filterSlice(spaceId);
  const saved = useStore(slice, (s) => s.value);
  const options = projectFilterOptions(threads);
  const hasNoProject = threads.some((t) => !t.repo);
  return {
    options,
    hasNoProject,
    selected: resolveFilter(saved, options, hasNoProject),
    select: (filter: ProjectFilter) => slice.setState({ value: filter }),
  };
}

/** One option per project the threads work in, the latest started first. */
export function projectFilterOptions(
  threads: readonly Thread[],
): ProjectFilterOption[] {
  const usage = projectUsage(threads);
  const byRef = new Map<string, ProjectFilterOption>();
  for (const t of threads) {
    const ref = projectRef(t.repo);
    if (!t.repo || !ref || byRef.has(ref)) continue;
    byRef.set(ref, { ref, name: t.repo.project, path: t.repo.path });
  }
  return [...byRef.values()].sort(
    (a, b) => usage.get(b.ref)!.lastAt - usage.get(a.ref)!.lastAt,
  );
}

export function resolveFilter(
  saved: ProjectFilter,
  options: readonly ProjectFilterOption[],
  hasNoProject: boolean,
): ProjectFilter {
  if (saved === NO_PROJECT) return hasNoProject ? saved : null;
  return options.some((o) => o.ref === saved) ? saved : null;
}

export function matchesProjectFilter(thread: Thread, filter: ProjectFilter) {
  if (filter === null) return true;
  if (filter === NO_PROJECT) return !thread.repo;
  return projectRef(thread.repo) === filter;
}

/** Pinned, active and settled as the sidebar lists them, narrowed to the filter's project; a group goes by its top thread. */
export function filteredSidebarLists(
  threads: Thread[],
  spaceId: string,
  filter: ProjectFilter,
) {
  const { pinned, active } = sidebarGroups(threads, spaceId);
  const matches = (t: Thread) => matchesProjectFilter(t, filter);
  return {
    pinned: pinned.filter((g) => matches(g.thread)),
    active: active.filter((g) => matches(g.thread)),
    settled: settledThreads(threads).filter(matches),
  };
}
