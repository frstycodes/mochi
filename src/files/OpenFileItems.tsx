import { Code, FolderOpen } from '@/icons';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { host } from '../host';
import type { DiskFile } from '../host/types/fs';
import { EDITOR_NAMES, openInEditor, REVEAL_IN, revealPath, useInstalledEditors } from './editors';

/** "Open in <editor>" (the first one installed) and "Show in Finder" for a ⋯ menu; nothing on the web build. */
export function OpenFileItems({ file }: { file: DiskFile }) {
  const [editor] = useInstalledEditors();
  if (!host.isDesktop) return null;
  return (
    <>
      {!!editor && (
        <DropdownMenuItem onSelect={() => openInEditor(editor, file.root, file.path)}>
          <Code />
          Open in {EDITOR_NAMES[editor]}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => revealPath(file.root, file.path)}>
        <FolderOpen />
        Show in {REVEAL_IN}
      </DropdownMenuItem>
    </>
  );
}
