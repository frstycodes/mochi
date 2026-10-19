import { useState } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import { ChevronRight } from '@/icons';
import { cn } from '@/lib/utils';
import type { DiffFile } from '../host/types/git';
import { visibleRows } from '../files/tree';
import { DiffStat } from '../WorkLog';
import { fileKey, type ChangeSection } from './files';

/** The changed files as a folder tree beside the diffs; picking a file scrolls its diff into view. */
export function ChangeTree({ sections, selected, onSelect }: { sections: ChangeSection[]; selected: string | null; onSelect: (file: DiffFile) => void }) {
  const [collapsed, setCollapsed] = useState(() => new Set<string>());
  const toggle = (key: string) =>
    setCollapsed((keys) => {
      const next = new Set(keys);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col gap-3 px-1.5 py-1.5">
      {sections.map((section) => {
        const prefix = section.title ?? '';
        const byPath = new Map(section.files.map((f) => [f.path, f]));
        const rows = visibleRows(section.tree, { has: (path) => !collapsed.has(`${prefix}:${path}`) });
        return (
          <ul key={prefix} role="tree" aria-label={section.title ?? 'Changed files'} className="flex flex-col">
            {!!section.title && (
              <li role="presentation" className="flex h-6 items-center gap-1.5 px-1.5 type-caption text-subtle-foreground">
                {section.title}
                <span className="tabular">{section.files.length}</span>
              </li>
            )}
            {rows.map(({ node, depth }) => {
              const file = byPath.get(node.path);
              const isOpen = !collapsed.has(`${prefix}:${node.path}`);
              const isSelected = !!file && fileKey(file) === selected;
              return (
                <li key={node.path} role="treeitem" aria-level={depth + 1} aria-expanded={file ? undefined : isOpen} aria-selected={isSelected}>
                  <button
                    type="button"
                    onClick={() => (file ? onSelect(file) : toggle(`${prefix}:${node.path}`))}
                    style={{ paddingLeft: 6 + depth * 16 }}
                    title={node.path}
                    className={cn(
                      'flex h-6.5 w-full items-center gap-1 rounded-md pr-1.5 text-left type-meta text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
                      isSelected && 'bg-accent text-foreground hover:bg-accent',
                    )}
                  >
                    {file ? <FileIcon fileName={node.name} autoAssign aria-hidden className="size-3.5 shrink-0" /> : <ChevronRight aria-hidden className={cn('size-3 shrink-0 text-subtle-foreground transition-transform duration-150', isOpen && 'rotate-90')} />}
                    <span className={cn('min-w-0 flex-1 truncate', file?.kind === 'deleted' && 'line-through decoration-subtle-foreground')}>{node.name}</span>
                    {!!file && <DiffStat added={file.added} removed={file.removed} />}
                  </button>
                </li>
              );
            })}
          </ul>
        );
      })}
    </div>
  );
}
