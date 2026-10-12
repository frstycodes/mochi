import { useEffect, useMemo, useState } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import { ChevronRight, Folder, FolderOpen } from 'reicon-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { FileContextMenu } from './FileContextMenu';

export function FileTree({ root, files, selected, onSelect }: { root: string; files: string[]; selected: string | null; onSelect: (path: string) => void }) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!selected) return;
    setExpanded((prev) => new Set([...prev, ...ancestors(selected)]));
  }, [selected]);
  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  return (
    <ScrollArea className="h-full">
      <ul role="tree" aria-label="Files" className="flex flex-col px-1.5 pb-2">
        {tree.map((node) => (
          <TreeRow key={node.path} root={root} node={node} depth={0} expanded={expanded} selected={selected} onToggle={toggle} onSelect={onSelect} />
        ))}
      </ul>
    </ScrollArea>
  );
}

interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

function TreeRow({ root, node, depth, expanded, selected, onToggle, onSelect }: { root: string; node: TreeNode; depth: number; expanded: Set<string>; selected: string | null; onToggle: (path: string) => void; onSelect: (path: string) => void }) {
  const isDir = !!node.children;
  const isOpen = expanded.has(node.path);
  const FolderIcon = isOpen ? FolderOpen : Folder;
  return (
    <li role="treeitem" aria-expanded={isDir ? isOpen : undefined} aria-selected={node.path === selected}>
      <FileContextMenu root={root} path={node.path} onOpen={isDir ? undefined : () => onSelect(node.path)}>
        <button
          type="button"
          onClick={() => (isDir ? onToggle(node.path) : onSelect(node.path))}
          style={{ paddingLeft: 4 + depth * 12 }}
          className={cn(
            'flex h-6.5 w-full items-center gap-1.5 rounded-md pr-2 text-left type-meta text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            node.path === selected && 'bg-sidebar-accent text-foreground',
          )}
        >
          {isDir ? <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-subtle-foreground', isOpen && 'rotate-90')} /> : <span className="size-3.5 shrink-0" />}
          {isDir ? <FolderIcon aria-hidden className="size-3.5 shrink-0" /> : <FileIcon fileName={node.name} autoAssign aria-hidden className="size-3.5 shrink-0" />}
          <span className="truncate">{node.name}</span>
        </button>
      </FileContextMenu>
      {isDir && isOpen && (
        <ul role="group">
          {node.children!.map((child) => (
            <TreeRow key={child.path} root={root} node={child} depth={depth + 1} expanded={expanded} selected={selected} onToggle={onToggle} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

function buildTree(files: string[]) {
  const root: TreeNode = { name: '', path: '', children: [] };
  const index = new Map([['', root]]);
  for (const file of files) {
    const parts = file.split('/');
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/');
      if (index.has(path)) return;
      const node: TreeNode = i === parts.length - 1 ? { name, path } : { name, path, children: [] };
      index.get(parts.slice(0, i).join('/'))!.children!.push(node);
      index.set(path, node);
    });
  }
  return sortTree(root.children!);
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((n) => (n.children ? { ...n, children: sortTree(n.children) } : n))
    .sort((a, b) => Number(!a.children) - Number(!b.children) || a.name.localeCompare(b.name));
}

function ancestors(path: string) {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}
