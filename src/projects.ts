import { persistedSlice } from './lib/uiStorage.ts';
import { useMemo, useSyncExternalStore } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { queryClient } from './query.ts';
import { queryKeys } from './queryKeys.ts';
import { host } from './host/index.ts';
import type { CloneSource, Project } from './host/types/projects.ts';
import type { Thread } from './model.ts';
import { getProfiles } from './profiles.ts';
import { getPrefs } from './settings/prefs.ts';

/**
 * A project is a folder. The project picker hands around a ref: the folder's absolute path on desktop, a bare name for the
 * web build's fixture projects (a browser never learns real paths).
 */
export function repoFor(ref: string, branch: string): NonNullable<Thread['repo']> {
  const project = projectName(ref);
  return isAbsolutePath(ref) ? { project, branch, path: ref } : { project, branch };
}

export function projectRef(repo: Thread['repo']) {
  return repo ? (repo.path ?? repo.project) : null;
}

export function projectName(ref: string) {
  return (
    ref
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || ref
  );
}

export function isAbsolutePath(path: string) {
  return /^(\/|[a-zA-Z]:[\\/])/.test(path);
}

/** This profile's projects, most recently used first by `threads` (the profile's); null until main answered. */
export function useProjects(spaceId: string, threads: readonly Thread[]): Project[] | null {
  const projectsQuery = useQuery(projectsQueryOptions(spaceId, threads));
  const projects = projectsQuery.data ?? null;
  return useMemo(() => projects && byRecentUse(projects, threads), [projects, threads]);
}

/** The registry's entry for a folder, from what's already loaded; it starts no read of its own. */
export function useProjectAt(spaceId: string, path: string | undefined): Project | undefined {
  const projectsQuery = useQuery({ queryKey: queryKeys.projects.list(spaceId), queryFn: () => host.projects.list(spaceId), enabled: false });
  return path ? projectsQuery.data?.find((p) => p.path === path) : undefined;
}

/** Per folder: its threads still in play, all of them, and when the latest started (store minutes). */
export function projectUsage(threads: readonly Thread[]) {
  const usage = new Map<string, { open: number; total: number; lastAt: number }>();
  for (const t of threads) {
    const ref = projectRef(t.repo);
    if (!ref) continue;
    const u = usage.get(ref) ?? { open: 0, total: 0, lastAt: 0 };
    usage.set(ref, { open: u.open + (t.status === 'settled' ? 0 : 1), total: u.total + 1, lastAt: Math.max(u.lastAt, t.startedAt) });
  }
  return usage;
}

let requested: string | null = null;
const requestListeners = new Set<() => void>();

/** Opens the new-thread page on this project (the sidebar's Projects); the page takes it once (`takeRequestedProject`). */
export function requestNewThreadIn(ref: string) {
  requested = ref;
  requestListeners.forEach((l) => l());
}

export function useRequestedProject() {
  return useSyncExternalStore(
    (listener) => {
      requestListeners.add(listener);
      return () => void requestListeners.delete(listener);
    },
    () => requested,
  );
}

export function takeRequestedProject() {
  const ref = requested;
  requested = null;
  requestListeners.forEach((l) => l());
  return ref;
}

/**
 * main's registry for the profile. The first load in a session also hands main the folders the profile used before it existed
 * (the recents this window kept, its threads' folders); main takes them in once (`migrate`) and only lists after.
 */
export function loadProjects(spaceId: string, threads: readonly Thread[]): Promise<Project[]> {
  return queryClient.fetchQuery(projectsQueryOptions(spaceId, threads));
}

const migrated = new Set<string>();

// Only the first read migrates: main announces every migrate as a change, and the refetch that triggers must only list.
// Marked before the call because that announcement lands while the migrate is still in flight.
export function projectsQueryOptions(spaceId: string, threads: readonly Thread[]) {
  return queryOptions({
    queryKey: queryKeys.projects.list(spaceId),
    queryFn: () => {
      if (migrated.has(spaceId)) return host.projects.list(spaceId);
      migrated.add(spaceId);
      return host.projects.migrate(spaceId, legacyFolders(spaceId, threads)).catch((error: unknown) => {
        migrated.delete(spaceId);
        throw error;
      });
    },
  });
}

/** Projects whose threads started last come first, then the newest added. */
export function byRecentUse(projects: Project[], threads: readonly Thread[]) {
  const lastUse = new Map<string, number>();
  for (const t of threads) {
    const ref = projectRef(t.repo);
    if (ref) lastUse.set(ref, Math.max(lastUse.get(ref) ?? 0, t.startedAt));
  }
  return [...projects].sort((a, b) => (lastUse.get(b.path) ?? 0) - (lastUse.get(a.path) ?? 0) || b.addedAt - a.addedAt);
}

/**
 * Add project's clone and create, the same calls whether this computer's UI or a device asks: into Settings › General ›
 * Projects folder, with gh and GitHub as the profile's own login (main holds the token; it never reaches here).
 */
export async function cloneProject(spaceId: string, source: CloneSource, onLine?: (line: string) => void): Promise<Project> {
  const opId = crypto.randomUUID();
  const off = onLine && host.projects.onProgress((p) => p.opId === opId && onLine(p.line));
  try {
    return await host.projects.clone(spaceId, source, { parentDir: getPrefs().projectsFolder, opId, githubUser: githubUserOf(spaceId) });
  } finally {
    off?.();
  }
}

export function createProject(spaceId: string, name: string, publish?: 'private' | 'public'): Promise<Project> {
  return host.projects.create(spaceId, name, { parentDir: getPrefs().projectsFolder, publish, githubUser: githubUserOf(spaceId) });
}

/** The profile's GitHub account (Settings › Profiles); unset runs as gh's active login. */
export const githubUserOf = (spaceId: string) => getProfiles().find((p) => p.id === spaceId)?.github || undefined;

export function refreshProjects(spaceId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(spaceId) });
}

host.projects.onChange(refreshProjects);

/** Where projects lived before the registry: this window's recents (browser storage), then its threads' folders. */
function legacyFolders(spaceId: string, threads: readonly Thread[]) {
  const fromThreads = [...threads].filter((t) => t.spaceId === spaceId).sort((a, b) => b.startedAt - a.startedAt).flatMap((t) => projectRef(t.repo) ?? []);
  return [...new Set([...legacyRecents(spaceId), ...fromThreads])];
}

const recentsSlice = persistedSlice<Record<string, unknown>>('mochi.projects.v1', {});

function legacyRecents(spaceId: string): string[] {
  try {
    const saved: unknown = recentsSlice.getState().value;
    const refs = (saved as Record<string, unknown> | null)?.[spaceId];
    return Array.isArray(refs) ? refs.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

