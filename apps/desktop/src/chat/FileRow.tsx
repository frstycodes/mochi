import { useState, type ReactNode } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import { ChevronRight } from '@/icons';
import { cn } from '@/lib/utils';
import { PATCHES } from '../fixtures';
import { usePaneOpeners } from '../terminal/usePaneOpeners';
import { DiffStat, DiffView, Expand } from '../WorkLog';
import { patchSections, type TurnFile } from './turnChanges';

/** One file: icon, dimmed directory and its name (a link to the file viewer), +/− with the change bar; the row opens to its diff. */
export function FileRow({
  threadId,
  root,
  file,
  badge,
}: {
  threadId: string;
  root: string | null;
  file: TurnFile;
  badge?: ReactNode;
}) {
  const [isOpen, setOpen] = useState(false);
  const { openFile } = usePaneOpeners(threadId);
  const patches = (
    file.patches.length ? file.patches : [PATCHES[file.path] ?? '']
  ).filter((p) => patchSections(p).length > 0);
  const slash = file.path.lastIndexOf('/');
  const name = file.path.slice(slash + 1);
  // Calls logged before paths were made relative carry the absolute path; the Files tab takes paths inside the root.
  const path =
    root && file.path.startsWith(`${root}/`)
      ? file.path.slice(root.length + 1)
      : file.path;

  return (
    <li className="flex flex-col">
      <div
        className={cn(
          'relative isolate flex h-9 min-w-0 items-center gap-2.5 px-3 type-meta',
          patches.length > 0 && 'hover:bg-accent/60',
        )}
      >
        {patches.length > 0 && (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={`Diff of ${name}`}
            onClick={() => setOpen((o) => !o)}
            className="absolute inset-0 cursor-default focus-visible:outline-2 focus-visible:-outline-offset-2"
          />
        )}
        <FileIcon
          fileName={name}
          autoAssign
          aria-hidden
          className="size-4 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate" title={file.path}>
          <span className="text-subtle-foreground">
            {file.path.slice(0, slash + 1)}
          </span>
          <button
            type="button"
            onClick={() => openFile(path)}
            className="relative z-10 cursor-pointer text-foreground underline-offset-2 hover:underline focus-visible:underline"
          >
            {name}
          </button>
        </span>
        {badge}
        <DiffStat added={file.added} removed={file.removed} withBar />
        {patches.length > 0 ? (
          <Chevron isOpen={isOpen} />
        ) : (
          <span aria-hidden className="size-3.5 shrink-0" />
        )}
      </div>
      {patches.length > 0 && (
        <Expand isOpen={isOpen}>
          <div className="px-3 pb-3">
            <DiffView patch={patches.join('\n')} />
          </div>
        </Expand>
      )}
    </li>
  );
}

export function Chevron({ isOpen }: { isOpen: boolean }) {
  return (
    <ChevronRight
      aria-hidden
      className={cn(
        'size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150 motion-reduce:transition-none',
        isOpen && 'rotate-90',
      )}
    />
  );
}
