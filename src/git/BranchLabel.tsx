import type { ComponentProps } from 'react';
import { Folder, Hierarchy2, Unlink } from '@/icons';
import type { Repo } from '../model.ts';
import { cn } from '@/lib/utils';
import { branchText } from './workspace.ts';

/** Where the thread works: a detached HEAD (whatever the folder), the project folder, or its own worktree. */
export function BranchIcon({
  repo,
  className,
  ...props
}: { repo: Repo } & ComponentProps<typeof Folder>) {
  const isFolder = repo.mode === 'folder';
  const iconClass = cn('size-3.5 shrink-0', className);
  if (repo.isDetached)
    return (
      <Unlink
        aria-label={
          isFolder
            ? 'Detached HEAD in the project folder'
            : 'Detached HEAD in its own worktree'
        }
        className={iconClass}
        {...props}
      />
    );
  if (isFolder)
    return (
      <Folder aria-label="Project folder" className={iconClass} {...props} />
    );
  return (
    <Hierarchy2 aria-label="Own worktree" className={iconClass} {...props} />
  );
}

export function BranchName({
  repo,
  className,
  ...props
}: { repo: Repo } & ComponentProps<'span'>) {
  return (
    <span className={cn('min-w-0 truncate', className)} {...props}>
      {branchText(repo)}
    </span>
  );
}
