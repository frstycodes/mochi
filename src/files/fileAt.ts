import type { ThreadFiles } from './viewer.ts';

/**
 * Where a call's file reads from. The file host only takes paths relative to a root: inside the thread's folder that's the
 * folder (calls logged before paths were made relative carry the absolute path); a file read elsewhere (a scratch dir) is
 * read from its own folder.
 */
export function fileAt(files: ThreadFiles, path: string): ThreadFiles & { path: string } {
  if (files.root && path.startsWith(`${files.root}/`)) return { ...files, path: path.slice(files.root.length + 1) };
  if (!path.startsWith('/')) return { ...files, path };
  const cut = path.lastIndexOf('/');
  return { ...files, root: path.slice(0, cut) || '/', path: path.slice(cut + 1) };
}
