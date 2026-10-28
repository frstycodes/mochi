import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Thread } from './model';
import { endRename, titleToSave, useDialogRename } from './rename';
import { useHarness, useDispatch } from './store';
import { OwnerScope } from './remote/RemoteThreadScope';

/** Mounted once at the app root: renames started away from the thread's sidebar row (⌘K, the thread header's menu). */
export function RenameLayer() {
  const threadId = useDialogRename();
  return (
    <OwnerScope threadId={threadId}>
      <RenameFor threadId={threadId} />
    </OwnerScope>
  );
}

function RenameFor({ threadId }: { threadId: string | undefined }) {
  const { state } = useHarness();
  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread) return null;
  return <RenameDialog key={thread.id} thread={thread} />;
}

function RenameDialog({ thread }: { thread: Thread }) {
  const dispatch = useDispatch();
  const [startedFrom] = useState(thread.title);
  const [text, setText] = useState(thread.title);
  const save = (e: FormEvent) => {
    e.preventDefault();
    const title = titleToSave(startedFrom, text);
    if (title) dispatch({ type: 'rename', threadId: thread.id, title });
    endRename();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && endRename()}>
      <DialogContent aria-describedby={undefined}>
        <form onSubmit={save} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Rename thread</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={text}
            maxLength={120}
            aria-label="Thread title"
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={endRename}>
              Cancel
            </Button>
            <Button type="submit">Save name</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
