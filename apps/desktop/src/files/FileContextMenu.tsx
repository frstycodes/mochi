import type { ReactElement } from 'react';
import { Copy, File, Share, FolderOpen } from '@/icons';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { host } from '@/host';
import { copyText } from '../clipboard';
import {
  EDITOR_NAMES,
  openInEditor,
  REVEAL_IN,
  revealPath,
  useInstalledEditors,
} from './editors';

/** A file tree entry: open it here or in an installed editor, copy its path, reveal it on disk. Folders skip Open; the row toggles them. */
export function FileContextMenu({
  root,
  path,
  onOpen,
  children,
}: {
  root: string;
  path: string;
  onOpen?: () => void;
  children: ReactElement;
}) {
  const editors = useInstalledEditors();
  const hasOpenGroup = !!onOpen || editors.length > 0;
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-60">
        {hasOpenGroup && (
          <>
            <ContextMenuGroup>
              {!!onOpen && (
                <ContextMenuItem onClick={onOpen}>
                  <File />
                  Open
                </ContextMenuItem>
              )}
              {editors.map((editor) => (
                <ContextMenuItem
                  key={editor}
                  onClick={() => openInEditor(editor, root, path)}
                >
                  <Share />
                  Open in {EDITOR_NAMES[editor]}
                </ContextMenuItem>
              ))}
            </ContextMenuGroup>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => copyText(path, 'Copied path')}>
            <Copy />
            Copy path
          </ContextMenuItem>
          {host.isDesktop && (
            <ContextMenuItem onClick={() => revealPath(root, path)}>
              <FolderOpen />
              Reveal in {REVEAL_IN}
            </ContextMenuItem>
          )}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
