import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { host } from '@/host';
import type { Editor } from '@/host/types/fs';
import { IS_MAC, IS_WINDOWS } from '../keys';

export const EDITOR_NAMES = { vscode: 'VS Code', cursor: 'Cursor', zed: 'Zed' } satisfies Record<Editor, string>;

let installed: Promise<Editor[]> | undefined;

/** Editors found on this machine, asked once per session; empty on the web build. */
export function useInstalledEditors() {
  const [editors, setEditors] = useState<Editor[]>([]);
  useEffect(() => void (installed ??= host.fs.editors().catch(() => [])).then(setEditors), []);
  return editors;
}

export function openInEditor(editor: Editor, root: string, path: string, line?: number) {
  host.fs.openIn(editor, root, path, line).catch((e: Error) => toast.error(e.message));
}

export const REVEAL_IN = IS_MAC ? 'Finder' : IS_WINDOWS ? 'File Explorer' : 'file manager';

/** Desktop only (`host.fs.reveal` rejects on the web build); an empty `path` reveals `root`. */
export function revealPath(root: string, path: string) {
  host.fs.reveal(root, path).catch((e: Error) => toast.error(`Could not reveal ${path || root}`, { description: e.message }));
}
