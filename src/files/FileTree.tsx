import { FileIcon } from '@react-symbols/icons/utils';
import { ChevronRight, Folder, FolderOpen } from 'reicon-react';
import { cn } from '@/lib/utils';
import { FileContextMenu } from './FileContextMenu';
import { Highlighted } from './Highlighted';
import { toRanges, type TreeRow } from './tree';

export function FileTree({ root, rows, isExpanded, selected, active, highlights, onToggle, onSelect }: { root: string; rows: TreeRow[]; isExpanded: (path: string) => boolean; selected: string | null; active: string | null; highlights?: Map<string, number[]>; onToggle: (path: string) => void; onSelect: (path: string) => void }) {
  return (
    <ul role="tree" aria-label="Files" className="flex flex-col px-1.5 pb-2">
      {rows.map(({ node, depth }) => {
        const isDir = !!node.children;
        const isOpen = isDir && isExpanded(node.path);
        const FolderIcon = isOpen ? FolderOpen : Folder;
        return (
          <li key={node.path} role="treeitem" aria-level={depth + 1} aria-expanded={isDir ? isOpen : undefined} aria-selected={node.path === selected} data-key={`path:${node.path}`}>
            <FileContextMenu root={root} path={node.path} onOpen={isDir ? undefined : () => onSelect(node.path)}>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => (isDir ? onToggle(node.path) : onSelect(node.path))}
                style={{ paddingLeft: 4 + depth * 12 }}
                className={cn(
                  'flex h-6.5 w-full items-center gap-1.5 rounded-md pr-2 text-left type-meta text-muted-foreground outline-none hover:bg-sidebar-accent/60 hover:text-foreground',
                  node.path === active && 'bg-sidebar-accent/60 text-foreground',
                  node.path === selected && 'bg-sidebar-accent text-foreground hover:bg-sidebar-accent',
                )}
              >
                {isDir ? <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-subtle-foreground', isOpen && 'rotate-90')} /> : <span className="size-3.5 shrink-0" />}
                {isDir ? <FolderIcon aria-hidden className="size-3.5 shrink-0" /> : <FileIcon fileName={node.name} autoAssign aria-hidden className="size-3.5 shrink-0" />}
                <Highlighted text={node.name} ranges={toRanges(highlights?.get(node.path) ?? [])} className="truncate" markClassName="font-semibold text-foreground" />
              </button>
            </FileContextMenu>
          </li>
        );
      })}
    </ul>
  );
}
