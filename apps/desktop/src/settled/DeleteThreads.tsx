import { useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { toast } from '@/toast/store';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { plural } from '@mochi/domain/lib/format';
import { removeThreadWorktree, useWorktreePaths } from '../git/worktrees';
import type { Thread } from '../model';
import { useHarness } from '../store';
import { deleteTitle } from './settled';

const openStore = createStore<{ threadIds: string[] }>(() => ({
  threadIds: [],
}));

/** Asks before deleting these threads for good (thread menu, palette, the Settled page); an empty list closes it. */
export function requestDelete(threadIds: string[]) {
  openStore.setState({ threadIds });
}

/** Mounted once at the app root. */
export function DeleteThreadsLayer() {
  const threadIds = useStore(openStore, (s) => s.threadIds);
  const { state } = useHarness();
  const threads = state.threads.filter((t) => threadIds.includes(t.id));
  return (
    <AlertDialog
      open={threads.length > 0}
      onOpenChange={(open) => !open && requestDelete([])}
    >
      {threads.length > 0 && (
        // Keyed: another request starts with the worktree box unticked.
        <DeleteThreadsDialog key={threadIds.join()} threads={threads} />
      )}
    </AlertDialog>
  );
}

function DeleteThreadsDialog({ threads }: { threads: Thread[] }) {
  const { dispatch } = useHarness();
  const paths = useWorktreePaths();
  const [isRemovingTrees, setRemovingTrees] = useState(false);
  const withTrees = threads.filter((t) => !!paths[t.id]);
  const n = threads.length;

  const remove = async () => {
    requestDelete([]);
    dispatch({ type: 'delete', threadIds: threads.map((t) => t.id) });
    const removing = isRemovingTrees ? withTrees : [];
    const failed = (
      await Promise.allSettled(removing.map((t) => removeThreadWorktree(t.id)))
    ).filter((r) => r.status === 'rejected').length;
    toast(plural(n, 'Thread deleted', `${n} threads deleted`), {
      description: failed
        ? `Git kept ${plural(failed, 'a worktree', `${failed} worktrees`)}, likely for uncommitted changes.`
        : undefined,
    });
  };

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{deleteTitle(threads)}</AlertDialogTitle>
        <AlertDialogDescription>
          Stops {plural(n, 'its agent', 'their agents')} and removes{' '}
          {plural(n, 'its', 'their')} history from Mochi. Files on disk stay.
          This can’t be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      {withTrees.length > 0 && (
        <Label className="flex items-center gap-2 type-body font-normal">
          <Checkbox
            checked={isRemovingTrees}
            onCheckedChange={(checked) => setRemovingTrees(checked === true)}
          />
          Also remove{' '}
          {plural(
            withTrees.length,
            'its worktree',
            `${withTrees.length} worktrees`,
          )}
        </Label>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel>
          {plural(n, 'Keep thread', 'Keep threads')}
        </AlertDialogCancel>
        <AlertDialogAction variant="danger" onClick={() => void remove()}>
          {plural(n, 'Delete thread', `Delete ${n} threads`)}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
