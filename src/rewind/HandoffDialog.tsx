import { useEffect, useState } from 'react';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { useWorktreePath } from '../git/worktrees';
import { threadCwd } from '../host/cwd';
import { host } from '../host';
import type { Provider, Thread } from '../model';
import { useHarness } from '../store';
import { ProviderMark } from '../ui';
import { handoffPrompt, parseHandoff } from '../utility/prompts';
import { useDraft } from '../utility/useDraft';
import { handoffSummary, PROVIDER_NAME, type DiffStat } from './handoff';

/** Moves the thread to the other agent, with a context summary you can edit before it is sent. */
export function HandoffDialog({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const { dispatch } = useHarness();
  const [edited, setEdited] = useState<string | null>(null);
  const diff = useDiffStat(thread);
  const to: Provider = thread.providers[0] === 'claude' ? 'codex' : 'claude';
  const template = handoffSummary(thread, to, diff);
  const drafted = useHandoffDraft(thread, template);
  const summary = edited ?? drafted.text ?? template;

  const submit = () => {
    dispatch({ type: 'handoff', threadId: thread.id, to, summary });
    toast.success(`Handed "${thread.title}" to ${PROVIDER_NAME[to]}`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hand off to {PROVIDER_NAME[to]}</DialogTitle>
          <DialogDescription>
            {PROVIDER_NAME[to]} picks up from the summary below, in the same worktree. The handoff is logged in the transcript and as a goal revision.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="handoff-summary">Context summary</FieldLabel>
          <Textarea id="handoff-summary" value={summary} onChange={(e) => setEdited(e.target.value)} rows={12} className="max-h-80 font-mono type-caption" />
          {drafted.isDrafting && edited === null && <Shimmer className="type-caption">Summarizing the thread…</Shimmer>}
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>
            <ProviderMark provider={to} size={14} />
            Hand off to {PROVIDER_NAME[to]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Branch diff totals for the summary; null while loading or when the thread has no folder. */
function useDiffStat(thread: Thread) {
  useWorktreePath(thread.id);
  const cwd = threadCwd(thread);
  const base = thread.repo?.base;
  const [stat, setStat] = useState<DiffStat | null>(null);
  useEffect(() => {
    if (!cwd) return;
    let isCurrent = true;
    host.git.diff(cwd, 'branch', base).then(
      (d) => isCurrent && setStat({ files: d.files.length, added: d.files.reduce((n, f) => n + f.added, 0), removed: d.files.reduce((n, f) => n + f.removed, 0) }),
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [cwd, base]);
  return stat;
}

const TRANSCRIPT_MESSAGES = 12;

/** A model's summary for the receiving agent, from the template and the latest messages; drafted once when the dialog opens. */
function useHandoffDraft(thread: Thread, template: string) {
  const { draft, isDrafting } = useDraft('handoff', thread.spaceId);
  const [drafted, setDrafted] = useState<string | null>(null);
  useEffect(() => {
    let isCurrent = true;
    const transcript = thread.activity
      .filter((a) => a.kind === 'message' && a.who !== 'harness')
      .slice(-TRANSCRIPT_MESSAGES)
      .map((a) => `${a.who === 'you' ? 'User' : 'Agent'}: ${a.text.slice(0, 1500)}`);
    void draft(handoffPrompt(template, transcript)).then((text) => isCurrent && text && setDrafted(parseHandoff(text)));
    return () => {
      isCurrent = false;
    };
    // Once: the diff stat arriving changes `template`, and a second draft would replace the first.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { text: drafted, isDrafting };
}
