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
