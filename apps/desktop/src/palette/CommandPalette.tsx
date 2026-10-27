import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { isListed } from '../model';
import { profileById } from '../profiles';
import { useHarness } from '../store';
import { STEP_MARKS, StatusMark, lineColor } from '../ui';
import { ACTION_GROUPS, type PaletteAction } from './actions';
import type { ActionScope } from './when';
import { useActions } from './useActions';
import { ActionIcon } from '../menus/ActionItems';
import { Shortcut, useBinding } from '../Shortcut';
import { useReviewerChecks } from '../secondOpinion/reviewer';

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { state, dispatch } = useHarness();
  const { actions, run: runAction, scope } = useActions();
  useReviewerChecks();
  const liveSteps = useLiveSteps();
  const close = () => onOpenChange(false);
  const go = (threadId: string) => {
    dispatch({ type: 'go', view: { kind: 'thread', id: threadId } });
    close();
  };
  const run = (action: PaletteAction) => {
    runAction(action);
    close();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Run an action or jump to a thread, step or view"
    >
      <Command>
        <CommandInput placeholder="Run an action or jump to a thread" />
        <CommandList>
          <CommandEmpty>
            Nothing matches. Try an action, a thread title or a step name.
          </CommandEmpty>
          {ACTION_GROUPS.map((group) => (
            <CommandGroup key={group} heading={group}>
              {actions
                .filter((a) => a.group === group)
                .map((a) => (
                  <ActionItem
                    key={a.id}
                    action={a}
                    scope={scope}
                    onSelect={() => run(a)}
                  />
                ))}
            </CommandGroup>
          ))}
          <CommandGroup heading="Threads">
            {state.threads.filter(isListed).map((t) => (
              <CommandItem
                key={t.id}
                value={`${t.title} ${t.repo?.branch ?? ''} ${t.id}`}
                onSelect={() => go(t.id)}
              >
                <StatusMark status={t.status} size="icon" />
                <span className="truncate">{t.title}</span>
                <CommandShortcut className="tracking-normal">
                  {profileById(t.spaceId).name}
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Steps in this space">
            {liveSteps.map(({ thread, step }) => (
              <CommandItem
                key={step.id}
                value={`${step.title} ${thread.title}`}
                onSelect={() => go(thread.id)}
              >
                <StatusMark status={STEP_MARKS[step.status]} size="icon" />
                <span className="truncate">{step.title}</span>
                <span
                  aria-hidden
                  className="ml-auto size-2 shrink-0 rounded-full"
                  style={{ background: lineColor(thread.line) }}
                />
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

/** An action under its title for this scope; one that would fail right now is disabled with its reason underneath. */
function ActionItem({
  action,
  scope,
  onSelect,
}: {
  action: PaletteAction;
  scope: ActionScope;
  onSelect: () => void;
}) {
  const title = action.label?.(scope) ?? action.title;
  const reason = action.disabledReason?.(scope);
  const keys = useBinding(action.command);
  return (
    <CommandItem
      value={`${title} ${action.keywords ?? ''}`}
      disabled={!!reason}
      onSelect={onSelect}
    >
      <ActionIcon action={action} scope={scope} />
      {reason ? (
        <span className="flex min-w-0 flex-col">
          {title}
          <span className="type-caption text-pretty text-muted-foreground">
            {reason}
          </span>
        </span>
      ) : (
        title
      )}
      {!!keys && (
        <CommandShortcut className="tracking-normal">
          <Shortcut keys={keys} />
        </CommandShortcut>
      )}
    </CommandItem>
  );
}

function useLiveSteps() {
  const { state } = useHarness();
  return state.threads
    .filter((t) => t.spaceId === state.spaceId && t.status !== 'settled')
    .flatMap((t) =>
      t.steps
        .filter((s) => s.status !== 'done' && s.status !== 'dropped')
        .map((step) => ({ thread: t, step })),
    );
}
