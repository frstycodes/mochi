import { useEffect, useReducer } from 'react';
import { host } from '@/host';

// ponytail: one listing per folder shared by every chat link, re-listed when older than this on the next mount; files the
// agent creates later become links once a message mounts after that.
const TTL_MS = 15_000;

const listings = new Map<string, { files: Set<string> | null; at: number; loading?: Promise<void> }>();

/** The folder's files (`.gitignore` honoured) as a set for existence checks; null until listed or when listing failed. */
export function useWorktreeFiles(root: string | null) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!root) return;
    let isCurrent = true;
    const entry = listings.get(root);
    if (!entry?.loading && (!entry || Date.now() - entry.at > TTL_MS)) {
      const loading = host.fs.list(root).then(
        (list) => void listings.set(root, { files: new Set(list), at: Date.now() }),
        () => void listings.set(root, { files: null, at: Date.now() }),
      );
      listings.set(root, { files: entry?.files ?? null, at: entry?.at ?? 0, loading });
    }
    void listings.get(root)!.loading?.then(() => isCurrent && rerender());
    return () => {
      isCurrent = false;
    };
  }, [root]);
  return root ? (listings.get(root)?.files ?? null) : null;
}
