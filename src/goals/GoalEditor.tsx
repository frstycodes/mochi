import { useState, useSyncExternalStore } from 'react';
import { Plus, Trash } from '@/icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { Thread } from '../model';
import { useHarness } from '../store';
import { TooltipIconButton } from '../ui';
import { applyDraft, draftFrom, type DraftCriterion, type GoalDraft } from './edit';

let openThreadId: string | null = null;
const listeners = new Set<() => void>();

/** Opens the goal editor for a thread (goal card, summary, thread menu); null closes it. */
export function openGoalEditor(threadId: string | null) {
  openThreadId = threadId;
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Mounted once at the app root. */
export function GoalEditorLayer() {
  const threadId = useSyncExternalStore(subscribe, () => openThreadId);
  const { state } = useHarness();
  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread) return null;
  return <GoalEditor key={thread.id} thread={thread} onClose={() => openGoalEditor(null)} />;
}

/** The outcome and what done means; a save that changes either is one goal revision. The agent's plan is its own. Mount it only while open so the draft starts fresh from the thread. */
export function GoalEditor({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const { state, dispatch } = useHarness();
  const { draft, setGoal, setCriterion, removeCriterion, addCriterion } = useGoalDraft(thread);
  const [isDriftMuted, setDriftMuted] = useState(!!thread.drift?.isMuted);
  const hasEdits = applyDraft(thread, draft, state.now) !== thread;
  const hasDriftEdits = isDriftMuted !== !!thread.drift?.isMuted;
  const nextVersion = (thread.revisions.at(-1)?.n ?? 1) + 1;

  const save = () => {
    if (hasEdits) dispatch({ type: 'edit-goal', threadId: thread.id, draft });
    if (hasDriftEdits) dispatch({ type: 'drift-settings', threadId: thread.id, isMuted: isDriftMuted });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-5 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="type-title">{thread.goal ? 'Edit goal' : 'Make this a goal'}</DialogTitle>
          <DialogDescription>Saving a change to the goal or what done means makes it v{nextVersion}. The agent plans the work itself.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-text">Goal</Label>
          <Textarea id="goal-text" rows={2} value={draft.goal} onChange={(e) => setGoal(e.target.value)} placeholder="What will be true when this is done" className="min-h-0 type-body" />
        </div>

        <section aria-label="Done when" className="flex flex-col gap-1.5">
          <h3 className="type-body font-medium">Done when</h3>
          <ul className="flex flex-col gap-1">
            {draft.criteria.map((c, i) => (
              <li key={c.id ?? `new-${i}`} className="flex items-center gap-1.5">
                <Input value={c.text} onChange={(e) => setCriterion(i, { text: e.target.value })} aria-label={`Criterion ${i + 1}`} className="h-7 min-w-0 flex-1" />
                <Input value={c.command ?? ''} onChange={(e) => setCriterion(i, { command: e.target.value })} placeholder="Check command" aria-label={`Criterion ${i + 1} check command`} className="h-7 w-40 font-mono type-caption" />
                <TooltipIconButton label="Remove criterion" hint="Done no longer needs this" onClick={() => removeCriterion(i)}>
                  <Trash />
                </TooltipIconButton>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" className="self-start" onClick={addCriterion}>
            <Plus data-icon="inline-start" />
            Add criterion
          </Button>
        </section>

        <section aria-label="Drift guard" className="flex items-center gap-3 rounded-lg bg-muted/40 p-3">
          <Label htmlFor="drift-ask" className="flex-1 flex-col items-start gap-0.5">
            <span>Suggest a new thread for separate work</span>
            <span className="type-caption font-normal text-subtle-foreground">Only for messages that clearly start unrelated work. Messages always send.</span>
          </Label>
          <Switch id="drift-ask" checked={!isDriftMuted} onCheckedChange={(on) => setDriftMuted(!on)} />
        </section>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!hasEdits && !hasDriftEdits}>
            {hasEdits ? `Save as v${nextVersion}` : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useGoalDraft(thread: Thread) {
  const [draft, setDraft] = useState<GoalDraft>(() => draftFrom(thread));
  const setGoal = (goal: string) => setDraft((d) => ({ ...d, goal }));
  // Blank rows can stay while you type: `applyDraft` skips them.
  const setCriterion = (i: number, patch: Partial<DraftCriterion>) => setDraft((d) => ({ ...d, criteria: d.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const removeCriterion = (i: number) => setDraft((d) => ({ ...d, criteria: d.criteria.filter((_, j) => j !== i) }));
  const addCriterion = () => setDraft((d) => ({ ...d, criteria: [...d.criteria, { text: '' }] }));
  return { draft, setGoal, setCriterion, removeCriterion, addCriterion };
}

