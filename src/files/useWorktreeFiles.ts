import { createContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { host } from '@/host';
import { queryKeys } from '../queryKeys';

/**
 * Another computer's thread: its folder's files as that computer listed them. Links resolve against these, never against a
 * folder here that happens to share the path.
 */
export const RemoteFilesContext = createContext<ReadonlySet<string> | null>(null);

/** The folder's files (`.gitignore` honoured) as a set for existence checks; null until listed or when listing failed. */
export function useWorktreeFiles(root: string | null) {
  const filesQuery = useQuery({ queryKey: queryKeys.files.list(root), queryFn: () => host.fs.list(root!), enabled: !!root, select: (files) => new Set(files) });
  return filesQuery.data ?? null;
}
