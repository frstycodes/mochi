import { useState } from 'react';
import { Add, ArrowDown, ArrowUp, ClipboardTick, Pause, Trash3, Undo } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { DEFAULT_THRESHOLD } from '../drift';
import type { Size, Thread } from '../model';
import { useHarness } from '../store';
import { StepStatusIcon } from '../ui';
import { applyDraft, draftFrom, type DraftStep, type GoalDraft } from './edit';
import { templatesFor } from './templates';

/** Every save is one goal revision. Mount it only while open so the draft starts fresh from the thread. */
export function GoalEditor({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const { state, dispatch } = useHarness();
  const { draft, setGoal, updateStep, moveStep, addSteps } = useGoalDraft(thread);
  const [newTitle, setNewTitle] = useState('');
  const [drift, setDrift] = useState(thread.drift ?? { threshold: DEFAULT_THRESHOLD, isMuted: false });
  const hasEdits = applyDraft(thread, draft, state.now) !== thread;
  const hasDriftEdits = drift.threshold !== (thread.drift?.threshold ?? DEFAULT_THRESHOLD) || drift.isMuted !== !!thread.drift?.isMuted;
  const nextVersion = thread.revisions.length + 1;
  const templates = templatesFor(thread.spaceId);

  const add = () => {
    if (!newTitle.trim()) return;
    addSteps([{ title: newTitle.trim(), size: 1, gate: false }]);
    setNewTitle('');
  };

  const save = () => {
    if (hasEdits) dispatch({ type: 'edit-goal', threadId: thread.id, draft });
    if (hasDriftEdits) dispatch({ type: 'drift-settings', threadId: thread.id, ...drift });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-5 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="type-title">Edit goal</DialogTitle>
          <DialogDescription>Saving records the changes as v{nextVersion} in the timeline.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-text">Goal</Label>
          <Textarea id="goal-text" rows={2} value={draft.goal} onChange={(e) => setGoal(e.target.value)} className="min-h-0 type-body" />
        </div>

        <section aria-label="Steps" className="flex min-h-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 type-body font-medium">Steps</h3>
            {templates.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Add data-icon="inline-start" />
                    From template
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Templates in this space</DropdownMenuLabel>
                    {templates.map((t) => (
                      <DropdownMenuItem key={t.id} onSelect={() => addSteps(t.steps)}>
                        {t.name}
                        <span className="ml-auto tabular type-caption text-subtle-foreground">{t.steps.length} steps</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <ScrollArea type="scroll" className="-mx-1 [&>[data-slot=scroll-area-viewport]]:max-h-[min(46vh,26rem)]">
            <ol className="flex flex-col gap-0.5 px-1">
              {draft.steps.map((step, i) => (
                <StepEditRow
                  key={step.id ?? `new-${i}`}
                  step={step}
                  status={thread.steps.find((s) => s.id === step.id)?.status ?? 'ready'}
                  isFirst={i === 0}
                  isLast={i === draft.steps.length - 1}
                  onChange={(patch) => updateStep(i, patch)}
                  onMove={(by) => moveStep(i, by)}
                />
              ))}
            </ol>
          </ScrollArea>
          <form
            className="flex items-center gap-1.5 pl-7"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Add a step" aria-label="New step title" className="h-7 flex-1" />
            <Button type="submit" variant="outline" disabled={!newTitle.trim()}>
              Add step
            </Button>
          </form>
        </section>

        <section aria-label="Drift guard" className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
          <div className="flex items-center gap-3">
            <Label htmlFor="drift-ask" className="flex-1 flex-col items-start gap-0.5">
              <span>Ask before off-goal messages</span>
              <span className="type-caption font-normal text-subtle-foreground">Messages that share nothing with the goal show a card above the composer.</span>
            </Label>
            <Switch id="drift-ask" checked={!drift.isMuted} onCheckedChange={(on) => setDrift((d) => ({ ...d, isMuted: !on }))} />
          </div>
          <div className={cn('flex items-center gap-3', drift.isMuted && 'opacity-50')}>
            <Label id="drift-threshold" className="w-24 shrink-0">
              Sensitivity
            </Label>
            <Slider aria-labelledby="drift-threshold" disabled={drift.isMuted} min={0.05} max={0.4} step={0.05} value={[drift.threshold]} onValueChange={([threshold]) => setDrift((d) => ({ ...d, threshold }))} className="flex-1" />
            <span className="w-10 text-right tabular type-caption text-subtle-foreground">{Math.round(drift.threshold * 100)}%</span>
          </div>
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
  const updateStep = (i: number, patch: Partial<DraftStep>) => setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const moveStep = (i: number, by: -1 | 1) =>
    setDraft((d) => {
      const steps = [...d.steps];
      [steps[i], steps[i + by]] = [steps[i + by], steps[i]];
      return { ...d, steps };
    });
  const addSteps = (steps: Omit<DraftStep, 'id' | 'isRemoved' | 'isLocked'>[]) => setDraft((d) => ({ ...d, steps: [...d.steps, ...steps.map((s) => ({ ...s, isRemoved: false, isLocked: false }))] }));
  return { draft, setGoal, updateStep, moveStep, addSteps };
}

const SIZES = ['1', '2', '3'];

function StepEditRow({
  step,
  status,
  isFirst,
  isLast,
  onChange,
  onMove,
}: {
  step: DraftStep;
  status: Parameters<typeof StepStatusIcon>[0]['status'];
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<DraftStep>) => void;
  onMove: (by: -1 | 1) => void;
}) {
  const [isCriteriaOpen, setCriteriaOpen] = useState(!!step.acceptance);
  const isEditable = !step.isLocked && !step.isRemoved;

  return (
    <li className="flex flex-col gap-1 py-0.5">
      <div className="flex items-center gap-1.5">
        <span className="flex w-5 justify-center">
          <StepStatusIcon status={step.isRemoved ? 'dropped' : status} />
        </span>
        {step.isLocked ? (
          <span className="h-7 min-w-0 flex-1 truncate px-2 leading-7 text-muted-foreground">{step.title}</span>
        ) : (
          <Input value={step.title} disabled={!isEditable} onChange={(e) => onChange({ title: e.target.value })} aria-label="Step title" className={cn('h-7 min-w-0 flex-1', step.isRemoved && 'line-through')} />
        )}
        <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={String(step.size)} disabled={!isEditable} onValueChange={(v) => v && onChange({ size: Number(v) as Size })} aria-label="Size">
          {SIZES.map((s) => (
            <ToggleGroupItem key={s} value={s} aria-label={`Size ${s}`} className="tabular">
              {s}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button variant="ghost" size="icon-sm" disabled={!isEditable} aria-pressed={step.gate} aria-label="Pause before this step" title="Pause before this step" onClick={() => onChange({ gate: !step.gate })} className={cn(step.gate && 'bg-accent text-foreground')}>
          <Pause />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={step.isRemoved} aria-pressed={isCriteriaOpen} aria-label="Acceptance criteria" title="Acceptance criteria" onClick={() => setCriteriaOpen((o) => !o)} className={cn(isCriteriaOpen && 'bg-accent text-foreground')}>
          <ClipboardTick />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={isFirst} aria-label="Move up" onClick={() => onMove(-1)}>
          <ArrowUp />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={isLast} aria-label="Move down" onClick={() => onMove(1)}>
          <ArrowDown />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={step.isLocked} aria-label={step.isRemoved ? 'Keep this step' : 'Remove this step'} onClick={() => onChange({ isRemoved: !step.isRemoved })}>
          {step.isRemoved ? <Undo /> : <Trash3 />}
        </Button>
      </div>
      {isCriteriaOpen && !step.isRemoved && (
        <div className="flex items-center gap-1.5 pl-6.5">
          <Input
            value={step.acceptance?.text ?? ''}
            onChange={(e) => onChange({ acceptance: { ...step.acceptance, text: e.target.value } })}
            placeholder="Done when…"
            aria-label="Acceptance criteria"
            className="h-7 min-w-0 flex-1"
          />
          <Input
            value={step.acceptance?.command ?? ''}
            onChange={(e) => onChange({ acceptance: { text: step.acceptance?.text ?? '', command: e.target.value || undefined } })}
            placeholder="Command to check, optional"
            aria-label="Command to check"
            className="h-7 min-w-0 flex-1 font-mono type-caption"
          />
        </div>
      )}
    </li>
  );
}
