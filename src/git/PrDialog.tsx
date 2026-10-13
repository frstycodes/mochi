import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { host } from '../host';
import type { GitDiff } from '../host/types/git';
import type { Thread } from '../model';
import { parsePr, prPrompt } from '../utility/prompts';
import { useDraft } from '../utility/useDraft';

/**
 * The pull request before it opens: title and description start as the thread's title and goal, are replaced by a draft
 * from the branch's changes when one arrives, and stay yours to edit. Fields you already changed are never replaced.
 */
export function PrDialog({ thread, cwd, diff, githubUser, onCreate, onClose }: { thread: Thread; cwd: string; diff: GitDiff; githubUser?: string; onCreate: (pr: { title: string; body: string }) => Promise<void>; onClose: () => void }) {
  const [title, setTitle] = useState<{ text: string; isEdited?: boolean }>({ text: thread.title });
  const [body, setBody] = useState<{ text: string; isEdited?: boolean }>({ text: thread.goal });
  const { draft, isDrafting } = useDraft('pr', thread.spaceId);
  const base = diff.base.replace(/^origin\//, '');

  useEffect(() => {
    let isCurrent = true;
    const branchFiles = host.git.diff(cwd, 'branch', diff.base).then((d) => d.files, () => diff.files);
    void draft(branchFiles.then((files) => prPrompt(thread.title, thread.goal, files))).then((text) => {
      const pr = isCurrent && text ? parsePr(text) : null;
      if (!pr?.title) return;
      setTitle((t) => (t.isEdited ? t : { text: pr.title }));
      if (pr.body) setBody((b) => (b.isEdited ? b : { text: pr.body }));
    });
    return () => {
      isCurrent = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- drafted once per opening

  const create = async () => {
    onClose();
    await onCreate({ title: title.text.trim(), body: body.text.trim() });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Open a pull request</DialogTitle>
          <DialogDescription>
            From {diff.branch} into {base}
            {githubUser ? `, opened as ${githubUser}` : ''}. GitHub notifies the repository's watchers.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="pr-title">Title</FieldLabel>
          <Input id="pr-title" value={title.text} onChange={(e) => setTitle({ text: e.target.value, isEdited: true })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="pr-body">Description</FieldLabel>
          <Textarea id="pr-body" value={body.text} onChange={(e) => setBody({ text: e.target.value, isEdited: true })} rows={10} className="max-h-80 type-meta" />
          {isDrafting && <Shimmer className="type-caption">Drafting from the branch's changes…</Shimmer>}
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Button onClick={create} disabled={!title.text.trim()}>
            Create pull request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
