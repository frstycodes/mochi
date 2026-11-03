import { ArrowDown, ArrowUp, Warning } from '@/icons';
import { Button } from '@/components/ui/button';
import { plural } from '@mochi/domain/lib/format';
import { useCopyActions } from './copyActions';
import type { SyncDirection } from './git/copyStatus';
import type { CopyStatus } from './host/types/remote';
import {
  useCopyStatus,
  type ProjectCopy,
  type ProjectWithCopies,
} from './projectCopies';
import type { Computer } from './remote/computers';

/**
 * What the picked place will cost you, each with its fix, run on the computer that owns the copy. Silent where it costs
 * nothing: a new worktree starts from the remote's latest, so a behind copy says nothing there.
 */
export function PlaceNotes({ notes }: { notes: PlaceNote[] }) {
  const { sync } = useCopyActions();
  if (notes.length === 0) return null;
  return (
    <ul role="status" className="flex flex-col gap-1 px-2 pt-2 pb-1">
      {notes.map((note) => (
        <li
          key={note.text}
          className="flex items-start gap-1.5 type-caption text-subtle-foreground"
        >
          <Warning
            className="mt-0.5 size-3.5 shrink-0 text-warning"
            aria-hidden
          />
          <span className="min-w-0 flex-1">{note.text}</span>
          {!!note.action && (
            <Button
              size="xs"
              variant="outline"
              className="-my-0.5 shrink-0"
              onClick={() =>
                void sync(note.action!.copy, note.action!.direction)
              }
            >
              {note.action.direction === 'pull' ? <ArrowDown /> : <ArrowUp />}
              {note.action.label}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** `placeNotes` for the new-thread page's place, this computer's copy read here, the others from their catalogs. */
export function usePlaceNotes({
  project,
  picked,
  mode,
  startBranch,
  computers,
}: {
  project: ProjectWithCopies | undefined;
  picked: ProjectCopy | undefined;
  mode: 'worktree' | 'folder';
  startBranch: string | undefined;
  computers: Computer[];
}): PlaceNote[] {
  const localStatus = useCopyStatus(
    project?.copies.find((c) => c.machineId === null),
  );
  if (!project || !picked) return [];
  return placeNotes({
    project,
    picked,
    mode,
    // Until another computer's branches are read, its copy's own branch stands in for where the thread starts.
    startBranch:
      startBranch ?? (picked.machineId ? picked.status?.branch : undefined),
    statusOf: (c) => (c.machineId === null ? localStatus : c.status),
    nameOf: (c) =>
      computers.find((k) => k.id === c.machineId)?.name ?? 'Another computer',
  });
}

export interface PlaceNote {
  text: string;
  action?: { label: string; copy: ProjectCopy; direction: SyncDirection };
}

/**
 * The notes for starting on `picked`: behind its remote when the thread works in the folder itself, and another computer's
 * commits on the branch it starts from that never reached the remote. `statusOf` is each copy's git state as last read.
 */
export function placeNotes({
  project,
  picked,
  mode,
  startBranch,
  statusOf,
  nameOf,
}: {
  project: ProjectWithCopies;
  picked: ProjectCopy;
  mode: 'worktree' | 'folder';
  startBranch: string | undefined;
  statusOf: (copy: ProjectCopy) => CopyStatus | null | undefined;
  nameOf: (copy: ProjectCopy) => string;
}): PlaceNote[] {
  const notes: PlaceNote[] = [];
  const own = statusOf(picked)?.upstream;
  const name = nameOf(picked);
  const branch = statusOf(picked)?.branch;
  if (mode === 'folder' && own && own.behind > 0)
    notes.push(
      own.ahead > 0
        ? {
            text: `${name} is ${commits(own.behind)} behind origin/${branch} and has ${commits(own.ahead)} of its own; merge them there before the agent starts.`,
          }
        : {
            text: `${name} is ${commits(own.behind)} behind origin/${branch}; the agent would start on older code.`,
            action: {
              label: `Pull on ${name}`,
              copy: picked,
              direction: 'pull',
            },
          },
    );
  for (const copy of project.copies) {
    const status = statusOf(copy);
    if (copy === picked || !startBranch || status?.branch !== startBranch)
      continue;
    const ahead = status.upstream?.ahead ?? 0;
    if (ahead === 0) continue;
    const other = nameOf(copy);
    notes.push({
      text: `${other} has ${commits(ahead)} on ${startBranch} that aren’t pushed; this thread won’t see them.`,
      action: { label: `Push from ${other}`, copy, direction: 'push' },
    });
  }
  return notes;
}

const commits = (n: number) => plural(n, '1 commit', `${n} commits`);
