import { useStore } from 'zustand';
import { persistedFamily } from './lib/uiStorage.ts';
import type { Thread } from './model.ts';
import { useThreadProjectKey } from './projectCopies.ts';
import { projectRef } from './projectRef.ts';
import { parseRemoteThreadId } from './remote/ids.ts';
import { settledThreads, sidebarGroups } from './reorder.ts';

/** The sidebar's project filter: a project key, NO_PROJECT for folderless chats, null for all projects. */
export type ProjectFilter = string | null;

export const NO_PROJECT = ':no-project';

export type ProjectFilterOption = { ref: string; name: string; path?: string };

/** Which project a thread is in; the same key for one repo's threads on every computer (`threadProjectKey`). */
export type ProjectKeyOf = (thread: Thread) => string | null;

const byFolder: ProjectKeyOf = (thread) => projectRef(thread.repo);

const filterSlice = persistedFamily<ProjectFilter>(
  'mochi.sidebar.project-filter.',
  null,
);

/**
 * The profile's sidebar project filter, remembered per profile; a project no thread uses any more reads as all projects.
 * One option per project across your computers: its threads here and on the others filter together.
 */
export function useProjectFilter(spaceId: string, threads: readonly Thread[]) {
  const slice = filterSlice(spaceId);
  const saved = useStore(slice, (s) => s.value);
  const { keyOf, nameOf } = useThreadProjectKey(spaceId);
  const options = projectFilterOptions(threads, keyOf, nameOf);
  const hasNoProject = threads.some((t) => !t.repo);
  return {
    options,
    hasNoProject,
    keyOf,
    selected: resolveFilter(saved, options, hasNoProject),
    select: (filter: ProjectFilter) => slice.setState({ value: filter }),
  };
}

/** One option per project the threads work in, the latest started first; named as the project is, else as the thread's folder. */
export function projectFilterOptions(
  threads: readonly Thread[],
  keyOf: ProjectKeyOf = byFolder,
  nameOf: (key: string) => string | undefined = () => undefined,
): ProjectFilterOption[] {
  const byKey = new Map<string, ProjectFilterOption>();
  const lastAt = new Map<string, number>();
  for (const t of threads) {
    const key = keyOf(t);
    if (!t.repo || !key) continue;
    const seen = byKey.get(key);
    // The icon is looked up by this computer's folder, so only a thread here names the option's path.
    const isHere = !parseRemoteThreadId(t.id);
    byKey.set(key, {
      ref: key,
      name: nameOf(key) ?? seen?.name ?? t.repo.project,
      path: (isHere && t.repo.path) || seen?.path,
    });
    lastAt.set(key, Math.max(lastAt.get(key) ?? 0, t.startedAt));
  }
  return [...byKey.values()].sort(
    (a, b) => lastAt.get(b.ref)! - lastAt.get(a.ref)!,
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

export function matchesProjectFilter(
  thread: Thread,
  filter: ProjectFilter,
  keyOf: ProjectKeyOf = byFolder,
) {
  if (filter === null) return true;
  if (filter === NO_PROJECT) return !thread.repo;
  return keyOf(thread) === filter;
}

/** Pinned, active and settled as the sidebar lists them, narrowed to the filter's project; a group goes by its top thread. */
export function filteredSidebarLists(
  threads: Thread[],
  spaceId: string,
  filter: ProjectFilter,
  keyOf: ProjectKeyOf = byFolder,
) {
  const { pinned, active } = sidebarGroups(threads, spaceId);
  const matches = (t: Thread) => matchesProjectFilter(t, filter, keyOf);
  return {
    pinned: pinned.filter((g) => matches(g.thread)),
    active: active.filter((g) => matches(g.thread)),
    settled: settledThreads(threads).filter(matches),
  };
}
