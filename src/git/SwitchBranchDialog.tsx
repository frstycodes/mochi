import { useState } from 'react';
import { ChevronDown, WarningAlt } from '@/icons';
import { Button } from '@/components/ui/button';
import { plural } from '@/lib/format';
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from '@/components/ui/button-group';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { host } from '../host';
import type { Branch, ChangeStat, SwitchOptions } from '../host/types/git';
import { projectName } from '../projects';
import { DiffStat } from '../WorkLog';
import type { Workspace } from './WorkspacePicker';

/** Picking another branch while the project folder has uncommitted changes: stash them (the default), commit them as work in progress, bring them along, or discard them. */
export function SwitchBranchDialog({
  workspace,
  target,
  onClose,
}: {
  workspace: Workspace;
  target: Branch | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      {!!target && (
        <SwitchBranchContent
          workspace={workspace}
          target={target}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function SwitchBranchContent({
  workspace,
  target,
  onClose,
}: {
  workspace: Workspace;
  target: Branch;
  onClose: () => void;
}) {
  const { root, draft, onChange, branches, sharers } = workspace;
  const [isConfirmingDiscard, setConfirmingDiscard] = useState(false);
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = branches.list?.current ?? 'HEAD';
  const changes = branches.list?.changes ?? { files: 0, added: 0, removed: 0 };

  const run = async (mode: SwitchOptions['changes']) => {
    setPending(true);
    setError(null);
    try {
      await host.git.switchBranch(root, target.name, { changes: mode });
      onChange({ ...draft, branch: localBranch(target), isExisting: false });
      branches.refresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setConfirmingDiscard(false);
    } finally {
      setPending(false);
    }
  };

  if (isConfirmingDiscard)
    return (
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            Discard changes on <BranchName name={current} />?
          </DialogTitle>
          <DialogDescription>
            The changes to {fileCount(changes.files)} in {projectName(root)} are
            thrown away, untracked files included, then the folder switches to{' '}
            <BranchName name={target.name} />. This can't be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => setConfirmingDiscard(false)}
          >
            Keep changes
          </Button>
          <Button
            variant="danger"
            disabled={isPending}
            onClick={() => run('discard')}
          >
            Discard {fileCount(changes.files)}
          </Button>
        </DialogFooter>
      </DialogContent>
    );

  return (
    <DialogContent showCloseButton={false} className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>
          Uncommitted changes on <BranchName name={current} />
        </DialogTitle>
        <DialogDescription>
          Handle them before switching to <BranchName name={target.name} />.
        </DialogDescription>
      </DialogHeader>
      {sharers.length > 0 && (
        <p className="flex gap-1.5 text-foreground">
          <WarningAlt
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-warning"
          />
          {sessionsWarning(sharers.length)}
        </p>
      )}
      <ChangeSummary changes={changes} />
      {!!error && (
        <p
          role="alert"
          className="type-caption whitespace-pre-wrap text-destructive"
        >
          {error}
        </p>
      )}
      <DialogFooter className="sm:justify-between">
        <DialogClose asChild>
          <Button variant="outline" disabled={isPending}>
            Cancel
          </Button>
        </DialogClose>
        <ButtonGroup>
          <Button disabled={isPending} onClick={() => run('stash')}>
            Stash changes
          </Button>
          <ButtonGroupSeparator className="bg-primary-foreground/20" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                disabled={isPending}
                aria-label="Other ways to handle the changes"
              >
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
              <DropdownMenuItem onSelect={() => run('commit')}>
                Commit to <BranchName name={current} /> as work in progress
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run('bring')}>
                Bring changes to <BranchName name={localBranch(target)} />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmingDiscard(true)}
              >
                Discard changes
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      </DialogFooter>
    </DialogContent>
  );
}

function BranchName({ name }: { name: string }) {
  return <code className="font-mono">{name}</code>;
}

function ChangeSummary({ changes }: { changes: ChangeStat }) {
  return (
    <p className="flex items-center gap-2 text-muted-foreground">
      {fileCount(changes.files)} changed
      <DiffStat added={changes.added} removed={changes.removed} />
    </p>
  );
}

/** `origin/feat` switches to (and creates) the local `feat`. */
const localBranch = (b: Branch) =>
  b.isRemote ? b.name.slice(b.name.indexOf('/') + 1) : b.name;

const fileCount = (n: number) => plural(n, '1 file', `${n} files`);
const sessionsWarning = (n: number) =>
  `${plural(n, '1 other session is', `${n} other sessions are`)} using this folder. Switching branches will affect them too.`;
