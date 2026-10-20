import { useState } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import { ChevronRight, FileCode } from '@/icons';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PATCHES } from '../fixtures';
import type { Thread } from '../model';
import { usePaneOpeners } from '../terminal/usePaneOpeners';
import { threadCwd } from '@/host/cwd';
import { CallList, DiffStat, DiffView, Expand } from '../WorkLog';
import { countLabel, DisabledTooltip, FileList } from '../rewind/RewindLayer';
import { useTurnUndo, type UndoConflicts } from '../rewind/useTurnUndo';
import { patchSections, type TurnChanges, type TurnFile } from './turnChanges';
import { useTurnDiff } from './useTurnDiff';

const ROWS_SHOWN = 3;

/** The files one finished turn changed, like Claude's: totals and Undo (none in a replay) up top, a row per file that opens to its diff, the first three then "Show N more". */
export function TurnChangesCard({ thread, turn, ...props }: { thread: Thread; turn: TurnChanges; isReadOnly?: boolean; className?: string }) {
  const changes = useTurnDiff(thread, turn);
  return changes.files.length > 0 && <ChangesCard thread={thread} turn={changes} {...props} />;
}

function ChangesCard({ thread, turn, isReadOnly, className }: { thread: Thread; turn: TurnChanges; isReadOnly?: boolean; className?: string }) {
  const [isOpen, setOpen] = useState(true);
  const [isShowingAll, setShowingAll] = useState(false);
  const undo = useTurnUndo(thread, turn);
  const shown = isShowingAll ? turn.files : turn.files.slice(0, ROWS_SHOWN);
  const hidden = turn.files.length - shown.length;
  const title = `${undo.isUndone ? 'Undid changes to' : 'Edited'} ${countLabel(turn.files.length, 'file')}`;

  return (
    <section aria-label={title} className={cn('overflow-hidden rounded-xl border', className)}>
      {/* One toggle stretched under the header; Undo sits above it. */}
      <div className="relative isolate flex h-9 min-w-0 items-center gap-2.5 px-3 type-meta hover:bg-accent/60">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label={isOpen ? `Hide the ${countLabel(turn.files.length, 'file')}` : `Show the ${countLabel(turn.files.length, 'file')}`}
          onClick={() => setOpen((o) => !o)}
          className="absolute inset-0 cursor-default focus-visible:outline-2 focus-visible:-outline-offset-2"
        />
        <FileCode aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className={cn('min-w-0 flex-1 truncate font-medium', undo.isUndone ? 'text-muted-foreground' : 'text-foreground')}>{title}</span>
        {!undo.isUndone && !isReadOnly && (
          <span className="relative z-10 -my-1">
            <DisabledTooltip reason={undo.reason}>
              <Button
                variant="ghost"
                size="sm"
                disabled={!!undo.reason || undo.isPending}
                onClick={() => void undo.request()}
                className="text-muted-foreground"
              >
                Undo
              </Button>
            </DisabledTooltip>
          </span>
        )}
        <DiffStat added={turn.added} removed={turn.removed} />
        <Chevron isOpen={isOpen} />
      </div>
      <Expand isOpen={isOpen}>
        <CallList className="rounded-none border-x-0 border-b-0">
          {shown.map((file) => (
            <FileRow key={file.path} threadId={thread.id} root={threadCwd(thread)} file={file} />
          ))}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setShowingAll(true)}
                className="flex h-9 w-full cursor-default items-center px-3 text-left type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2"
              >
                Show {hidden} more
              </button>
            </li>
          )}
        </CallList>
      </Expand>
      {!!undo.conflicts && <UndoConfirm conflicts={undo.conflicts} onConfirm={() => void undo.run()} onCancel={undo.cancel} />}
    </section>
  );
}

/** One file: icon, dimmed directory and its name (a link to the file viewer), +/− with the change bar; the row opens to its diff. */
function FileRow({ threadId, root, file }: { threadId: string; root: string | null; file: TurnFile }) {
  const [isOpen, setOpen] = useState(false);
  const { openFile } = usePaneOpeners(threadId);
  const patches = (file.patches.length ? file.patches : [PATCHES[file.path] ?? '']).filter((p) => patchSections(p).length > 0);
  const slash = file.path.lastIndexOf('/');
  const name = file.path.slice(slash + 1);
  // Calls logged before paths were made relative carry the absolute path; the Files tab takes paths inside the root.
  const path = root && file.path.startsWith(`${root}/`) ? file.path.slice(root.length + 1) : file.path;

  return (
    <li className="flex flex-col">
      <div className={cn('relative isolate flex h-9 min-w-0 items-center gap-2.5 px-3 type-meta', patches.length > 0 && 'hover:bg-accent/60')}>
        {patches.length > 0 && (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={`Diff of ${name}`}
            onClick={() => setOpen((o) => !o)}
            className="absolute inset-0 cursor-default focus-visible:outline-2 focus-visible:-outline-offset-2"
          />
        )}
        <FileIcon fileName={name} autoAssign aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={file.path}>
          <span className="text-subtle-foreground">{file.path.slice(0, slash + 1)}</span>
          <button
            type="button"
            onClick={() => openFile(path)}
            className="relative z-10 cursor-pointer text-foreground underline-offset-2 hover:underline focus-visible:underline"
          >
            {name}
          </button>
        </span>
        <DiffStat added={file.added} removed={file.removed} withBar />
        {patches.length > 0 ? <Chevron isOpen={isOpen} /> : <span aria-hidden className="size-3.5 shrink-0" />}
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

function Chevron({ isOpen }: { isOpen: boolean }) {
  return (
    <ChevronRight
      aria-hidden
      className={cn('size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150 motion-reduce:transition-none', isOpen && 'rotate-90')}
    />
  );
}

function UndoConfirm({ conflicts, onConfirm, onCancel }: { conflicts: UndoConflicts; onConfirm: () => void; onCancel: () => void }) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Undo these changes?</AlertDialogTitle>
          <AlertDialogDescription>
            Each file goes back to how it was before this turn, so later edits to it go too. The chat stays as it is, and you can put the files back right
            after.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {conflicts.later.length > 0 && <FileList title={`Edited again in a later turn (${conflicts.later.length})`} paths={conflicts.later} />}
        {conflicts.outside.length > 0 && (
          <FileList title={`Changed outside the agent since its last turn (${conflicts.outside.length})`} paths={conflicts.outside} />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep changes</AlertDialogCancel>
          <Button variant="danger" onClick={onConfirm}>
            Undo changes
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
