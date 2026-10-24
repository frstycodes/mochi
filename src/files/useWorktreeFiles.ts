import { createContext, useMemo } from 'react';
import { useFileList } from './useFiles';

/**
 * Another computer's thread: its folder's files as that computer listed them. Links resolve against these, never against a
 * folder here that happens to share the path.
 */
export const RemoteFilesContext = createContext<ReadonlySet<string> | null>(null);

/** The folder's files (`.gitignore` honoured) as a set for existence checks; null until listed or when listing failed. */
export function useWorktreeFiles(root: string | null) {
  const { files } = useFileList(root);
  return useMemo(() => (files ? new Set(files) : null), [files]);
}
