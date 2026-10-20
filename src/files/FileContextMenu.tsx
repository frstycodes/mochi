import type { ReactNode } from 'react';
import { Copy, File, Share, FolderOpen } from '@/icons';
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { host } from '@/host';
import { copyText } from '../clipboard';
import { EDITOR_NAMES, openInEditor, REVEAL_IN, revealPath, useInstalledEditors } from './editors';

/** A file tree entry: open it here or in an installed editor, copy its path, reveal it on disk. Folders skip Open; the row toggles them. */
export function FileContextMenu({ root, path, onOpen, children }: { root: string; path: string; onOpen?: () => void; children: ReactNode }) {
  const editors = useInstalledEditors();
  const hasOpenGroup = !!onOpen || editors.length > 0;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        {hasOpenGroup && (
          <>
            <ContextMenuGroup>
              {!!onOpen && (
                <ContextMenuItem onSelect={onOpen}>
                  <File />
                  Open
                </ContextMenuItem>
              )}
              {editors.map((editor) => (
                <ContextMenuItem key={editor} onSelect={() => openInEditor(editor, root, path)}>
                  <Share />
                  Open in {EDITOR_NAMES[editor]}
                </ContextMenuItem>
              ))}
            </ContextMenuGroup>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuGroup>
          <ContextMenuItem onSelect={() => copyText(path, 'Copied path')}>
            <Copy />
            Copy path
          </ContextMenuItem>
          {host.isDesktop && (
            <ContextMenuItem onSelect={() => revealPath(root, path)}>
              <FolderOpen />
              Reveal in {REVEAL_IN}
            </ContextMenuItem>
          )}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
