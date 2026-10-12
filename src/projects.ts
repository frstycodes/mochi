import { useSyncExternalStore } from 'react';
import type { Thread } from './model.ts';

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
  return ref.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ref;
}

export function isAbsolutePath(path: string) {
  return /^(\/|[a-zA-Z]:[\\/])/.test(path);
}

const KEY = 'mochi.projects.v1';
const MAX_RECENT = 12;

let recent = load();
const listeners = new Set<() => void>();

/** Folders opened in this profile, most recent first. */
export function useSavedProjects(spaceId: string): string[] {
  return useSyncExternalStore(subscribe, () => recent[spaceId] ?? NONE);
}

export function addRecentProject(spaceId: string, ref: string) {
  recent = { ...recent, [spaceId]: [ref, ...(recent[spaceId] ?? []).filter((r) => r !== ref)].slice(0, MAX_RECENT) };
  try {
    localStorage.setItem(KEY, JSON.stringify(recent));
  } catch {
    // Storage blocked (private window, artifact sandbox): recents last for this session.
  }
  listeners.forEach((l) => l());
}

const NONE: string[] = [];

function load(): Record<string, string[]> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter(([, refs]) => Array.isArray(refs) && refs.every((r) => typeof r === 'string')));
  } catch {
    return {};
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
