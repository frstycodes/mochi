import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useWorktreePath } from '../git/worktrees';
import { threadCwd } from '../host/cwd';
import { host } from '../host';
import type { Provider, Thread } from '../model';
import { useHarness } from '../store';
import { ProviderMark } from '../ui';
import { handoffSummary, PROVIDER_NAME, stepOwner, type DiffStat } from './handoff';

const THREAD = 'thread';

/** Moves the thread or one open step to the other agent, with a context summary you can edit before it is sent. */
export function HandoffDialog({ thread, stepId, onClose }: { thread: Thread; stepId?: string; onClose: () => void }) {
  const { dispatch } = useHarness();
  const openSteps = thread.steps.filter((s) => s.status !== 'done' && s.status !== 'dropped');
  const [scope, setScope] = useState(stepId ?? THREAD);
  const [edited, setEdited] = useState<string | null>(null);
  const diff = useDiffStat(thread);
  const step = openSteps.find((s) => s.id === scope);
  const from = step ? stepOwner(thread, step) : thread.providers[0];
  const to: Provider = from === 'claude' ? 'codex' : 'claude';
  const summary = edited ?? handoffSummary(thread, to, step, diff);

  const submit = () => {
    dispatch({ type: 'handoff', threadId: thread.id, stepId: step?.id, to, summary });
    toast.success(`Handed ${step ? `"${step.title}"` : `"${thread.title}"`} to ${PROVIDER_NAME[to]}`);
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
          <FieldLabel htmlFor="handoff-scope">What moves</FieldLabel>
          <NativeSelect
            id="handoff-scope"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setEdited(null);
            }}
          >
            <NativeSelectOption value={THREAD}>Whole thread ({PROVIDER_NAME[thread.providers[0]]} now)</NativeSelectOption>
            {openSteps.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                Step: {s.title} ({PROVIDER_NAME[stepOwner(thread, s)]} now)
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="handoff-summary">Context summary</FieldLabel>
          <Textarea id="handoff-summary" value={summary} onChange={(e) => setEdited(e.target.value)} rows={12} className="max-h-80 font-mono type-caption" />
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
  const [stat, setStat] = useState<DiffStat | null>(null);
  useEffect(() => {
    if (!cwd) return;
    let isCurrent = true;
    host.git.diff(cwd, 'branch').then(
      (d) => isCurrent && setStat({ files: d.files.length, added: d.files.reduce((n, f) => n + f.added, 0), removed: d.files.reduce((n, f) => n + f.removed, 0) }),
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [cwd]);
  return stat;
}
