import { useState, type FormEvent } from 'react';
import { ArrowUp, ArrowUpRight } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import type { FollowedMachine } from '../host/types/remote';
import type { Thread } from '../model';
import { useMachines } from './useMachines';

/** The Changes pane's ship bar for another computer's thread: commit, push and the pull request run there, with its git and GitHub login. */
export function RemoteShipBar({
  machine,
  thread,
}: {
  machine: FollowedMachine;
  thread: Thread;
}) {
  const { run } = useMachines();
  const [shipping, setShipping] = useState<'commit' | 'open-pr' | null>(null);
  const canManage =
    machine.status === 'online' && machine.scopes.includes('manage');
  const reason = canManage
    ? undefined
    : machine.status === 'online'
      ? `${machine.name} hasn’t given this computer the manage scope`
      : `${machine.name} is offline`;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t px-3 py-2">
      <Button
        size="sm"
        variant="outline"
        disabled={!canManage}
        onClick={() => setShipping('commit')}
      >
        Commit…
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!canManage}
        onClick={() =>
          void run(machine.id, { type: 'push', threadId: thread.id })
        }
      >
        <ArrowUp data-icon="inline-start" />
        Push
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!canManage}
        onClick={() => setShipping('open-pr')}
      >
        <ArrowUpRight data-icon="inline-start" />
        Pull request…
      </Button>
      {!!reason && (
        <span className="type-caption text-subtle-foreground">{reason}</span>
      )}
      <ShipDialog
        kind={shipping}
        machine={machine}
        thread={thread}
        onClose={() => setShipping(null)}
      />
    </div>
  );
}

/** A commit message, or a pull request's title and body, written here and sent to the machine that owns the worktree. */
function ShipDialog({
  kind,
  machine,
  thread,
  onClose,
}: {
  kind: 'commit' | 'open-pr' | null;
  machine: FollowedMachine;
  thread: Thread;
  onClose: () => void;
}) {
  const { run } = useMachines();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSending(true);
    const result = await run(
      machine.id,
      kind === 'commit'
        ? { type: 'commit', threadId: thread.id, message: title }
        : { type: 'open-pr', threadId: thread.id, title, body },
    );
    setIsSending(false);
    if (!result.isOk) return;
    setTitle('');
    setBody('');
    onClose();
  };
  return (
    <Dialog open={!!kind} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {kind === 'commit' ? 'Commit' : 'Open a pull request'}
            </DialogTitle>
            <DialogDescription>
              {kind === 'commit'
                ? `Commits everything changed in this thread’s folder on ${machine.name}.`
                : `Pushes the branch and opens the pull request from ${machine.name}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="remote-ship-title">
              {kind === 'commit' ? 'Message' : 'Title'}
            </Label>
            <Input
              id="remote-ship-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>
          {kind === 'open-pr' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="remote-ship-body">Description</Label>
              <Textarea
                id="remote-ship-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || isSending}>
              {isSending && <Spinner data-icon="inline-start" />}
              {kind === 'commit' ? 'Commit' : 'Open pull request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
