import { useState } from 'react';
import { Add, ArrowDown, ArrowUp, ClipboardTick, Pause, Sparkles, Trash3, Undo } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getPrefs } from '../settings/prefs';
import type { Size, Thread } from '../model';
import { useHarness } from '../store';
import { StepStatusIcon, TooltipIconButton } from '../ui';
import { applyDraft, draftFrom, type DraftStep, type GoalDraft } from './edit';
import { templatesFor } from './templates';
import { goalPrompt, parseSteps } from '../utility/prompts';
import { useDraft } from '../utility/useDraft';

/** Every save is one goal revision. Mount it only while open so the draft starts fresh from the thread. */
export function GoalEditor({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const { state, dispatch } = useHarness();
  const { draft, setGoal, updateStep, moveStep, addSteps } = useGoalDraft(thread);
  const [newTitle, setNewTitle] = useState('');
  const [isDriftMuted, setDriftMuted] = useState(!!thread.drift?.isMuted);
  const hasEdits = applyDraft(thread, draft, state.now) !== thread;
  const hasDriftEdits = isDriftMuted !== !!thread.drift?.isMuted;
  const nextVersion = thread.revisions.length + 1;
  const templates = templatesFor(thread.spaceId);
  const stepsDraft = useDraft('goal', thread.spaceId);
  const draftSteps = async () => {
    const text = await stepsDraft.draft(goalPrompt(draft.goal));
    if (text) addSteps(parseSteps(text).map((title) => ({ title, size: getPrefs().stepSize, gate: false })));
  };

  const add = () => {
    if (!newTitle.trim()) return;
    addSteps([{ title: newTitle.trim(), size: getPrefs().stepSize, gate: false }]);
    setNewTitle('');
  };

  const save = () => {
    if (hasEdits) dispatch({ type: 'edit-goal', threadId: thread.id, draft });
    if (hasDriftEdits) dispatch({ type: 'drift-settings', threadId: thread.id, isMuted: isDriftMuted });
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
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button variant="ghost" size="sm" onClick={draftSteps} disabled={!draft.goal.trim() || stepsDraft.isDrafting}>
                    <Sparkles data-icon="inline-start" />
                    {stepsDraft.isDrafting ? 'Drafting…' : 'Draft steps'}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-60">Adds steps for the goal above, written on your Background tasks model. Review them before you save.</TooltipContent>
            </Tooltip>
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

const SIZES = ['1', '2', '3'] as const;
const SIZE_NAMES = { '1': 'Small', '2': 'Medium', '3': 'Large' } satisfies Record<(typeof SIZES)[number], string>;

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
        <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={String(step.size)} disabled={!isEditable} onValueChange={(v) => v && onChange({ size: Number(v) as Size })} aria-label="Step size">
          {SIZES.map((s) => (
            <Tooltip key={s}>
              <TooltipTrigger asChild>
                <ToggleGroupItem value={s} aria-label={`${SIZE_NAMES[s]} step`}>
                  {SIZE_NAMES[s][0]}
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent className="max-w-60 flex-col items-start gap-0.5">
                <span className="block font-medium">{SIZE_NAMES[s]} step</span>
                <span className="block opacity-80">Counts {s} {s === '1' ? 'point' : 'points'} toward the goal's progress and ETA.</span>
              </TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
        <TooltipIconButton
          label={step.gate ? 'Pauses before this step' : 'Pause before this step'}
          hint="The agent stops and asks you in the Queue before it starts this step."
          disabled={!isEditable}
          aria-pressed={step.gate}
          onClick={() => onChange({ gate: !step.gate })}
          className={cn(step.gate && 'bg-accent text-foreground')}
        >
          <Pause />
        </TooltipIconButton>
        <TooltipIconButton label="Acceptance criteria" hint="What has to be true for this step to count as done, and an optional command that checks it." disabled={step.isRemoved} aria-pressed={isCriteriaOpen} onClick={() => setCriteriaOpen((o) => !o)} className={cn(isCriteriaOpen && 'bg-accent text-foreground')}>
          <ClipboardTick />
        </TooltipIconButton>
        <TooltipIconButton label="Move up" disabled={isFirst} onClick={() => onMove(-1)}>
          <ArrowUp />
        </TooltipIconButton>
        <TooltipIconButton label="Move down" disabled={isLast} onClick={() => onMove(1)}>
          <ArrowDown />
        </TooltipIconButton>
        <TooltipIconButton label={step.isRemoved ? 'Keep this step' : 'Remove this step'} hint={step.isLocked ? "Done steps stay in the goal's history." : undefined} disabled={step.isLocked} onClick={() => onChange({ isRemoved: !step.isRemoved })}>
          {step.isRemoved ? <Undo /> : <Trash3 />}
        </TooltipIconButton>
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
