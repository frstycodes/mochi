import { useTheme } from 'next-themes';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { SPACES } from '../model';
import { useReviewMode } from '../review/useReviewMode';
import { useHarness } from '../store';
import { StepStatusIcon, ThreadStatusIcon, lineColor } from '../ui';
import { ACTIONS, ACTION_GROUPS, type ActionContext, type PaletteAction } from './actions';
import { available, scopeOf } from './when';
import { Shortcut } from '../Shortcut';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { state, dispatch } = useHarness();
  const { setTheme } = useTheme();
  const review = useReviewMode();
  const scope = scopeOf(state);
  const ctx: ActionContext = { state, dispatch, scope, setTheme, openReview: review.open };
  const actions = available<PaletteAction>(ACTIONS, scope);
  const liveSteps = useLiveSteps();
  const close = () => onOpenChange(false);
  const go = (threadId: string) => {
    review.close();
    dispatch({ type: 'go', view: { kind: 'thread', id: threadId } });
    close();
  };
  const run = (action: PaletteAction) => {
    if (action.id !== 'go-review') review.close();
    action.run(ctx);
    close();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Run an action or jump to a thread, step or view">
      <Command>
        <CommandInput placeholder="Run an action or jump to a thread" />
        <CommandList>
          <CommandEmpty>Nothing matches. Try an action, a thread title or a step name.</CommandEmpty>
          {ACTION_GROUPS.map((group) => (
            <CommandGroup key={group} heading={group}>
              {actions
                .filter((a) => a.group === group)
                .map((a) => (
                  <CommandItem key={a.id} value={`${a.title} ${a.keywords ?? ''}`} onSelect={() => run(a)}>
                    <a.icon />
                    {a.title}
                    {!!a.shortcut && <CommandShortcut className="tracking-normal">
                        <Shortcut keys={a.shortcut} />
                      </CommandShortcut>}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
          <CommandGroup heading="Threads">
            {state.threads.map((t) => (
              <CommandItem key={t.id} value={`${t.title} ${t.repo?.branch ?? ''} ${t.id}`} onSelect={() => go(t.id)}>
                <ThreadStatusIcon status={t.status} />
                <span className="truncate">{t.title}</span>
                <CommandShortcut className="tracking-normal">{SPACES.find((s) => s.id === t.spaceId)?.name}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Steps in this space">
            {liveSteps.map(({ thread, step }) => (
              <CommandItem key={step.id} value={`${step.title} ${thread.title}`} onSelect={() => go(thread.id)}>
                <StepStatusIcon status={step.status} />
                <span className="truncate">{step.title}</span>
                <span aria-hidden className="ml-auto size-2 shrink-0 rounded-full" style={{ background: lineColor(thread.line) }} />
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function useLiveSteps() {
  const { state } = useHarness();
  return state.threads
    .filter((t) => t.spaceId === state.spaceId && t.status !== 'settled')
    .flatMap((t) => t.steps.filter((s) => s.status !== 'done' && s.status !== 'dropped').map((step) => ({ thread: t, step })));
}
