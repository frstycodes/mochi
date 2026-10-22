import { useQuery } from '@tanstack/react-query';
import { toast } from '@/toast/store';
import { host } from '@/host';
import type { Editor } from '@/host/types/fs';
import { IS_MAC, IS_WINDOWS } from '../keys';
import { queryKeys } from '../queryKeys';

export const EDITOR_NAMES = { vscode: 'VS Code', cursor: 'Cursor', zed: 'Zed' } satisfies Record<Editor, string>;


/** Editors found on this machine, asked once per session; empty on the web build. */
export function useInstalledEditors() {
  const editorsQuery = useQuery({ queryKey: queryKeys.files.editors(), queryFn: () => host.fs.editors(), staleTime: Infinity });
  return editorsQuery.data ?? [];
}

export function openInEditor(editor: Editor, root: string, path: string, line?: number) {
  host.fs.openIn(editor, root, path, line).catch((e: Error) => toast.error(e.message));
}

export const REVEAL_IN = IS_MAC ? 'Finder' : IS_WINDOWS ? 'File Explorer' : 'file manager';

/** Desktop only (`host.fs.reveal` rejects on the web build); an empty `path` reveals `root`. */
export function revealPath(root: string, path: string) {
  host.fs.reveal(root, path).catch((e: Error) => toast.error(`Could not reveal ${path || root}`, { description: e.message }));
}
