import { Fragment } from 'react';
import { ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut } from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Thread } from '../model';
import { ACTIONS, type PaletteAction } from '../palette/actions';
import { scopeOf, splitByRule, type ScopeTarget } from '../palette/when';
import { useActionContext, useActions } from '../palette/useActions';
import { Shortcut } from '../Shortcut';

type Groups = readonly (readonly string[])[];

/** Registry actions for one target as context menu items, in the given groups; unavailable ones drop out, empty groups and their separators too. */
export function ActionItems({ target, groups }: { target: ScopeTarget; groups: Groups }) {
  const { actions, run } = useActions(target);
  // Action ids are plain strings: a typo would silently drop the item, so dev builds fail loudly instead.
  if (import.meta.env.DEV) groups.flat().forEach((id) => ACTIONS.some((a) => a.id === id) || console.error(`Context menu lists unknown action "${id}"`));
  const shown = groups.map((ids) => ids.flatMap((id) => actions.filter((a) => a.id === id))).filter((g) => g.length > 0);
  return shown.map((group, i) => (
    <Fragment key={group[0].id}>
      {i > 0 && <ContextMenuSeparator />}
      <ContextMenuGroup>
        {group.map((action) => (
          <ActionItem key={action.id} action={action} onSelect={() => run(action)} />
        ))}
      </ContextMenuGroup>
    </Fragment>
  ));
}

/**
 * The same registry actions over several threads: only actions with a `many` form, shown when their rule fits at least one thread,
 * disabled with the reason when it doesn't fit them all.
 */
export function BulkActionItems({ threadIds, groups }: { threadIds: string[]; groups: Groups }) {
  const { base } = useActionContext();
  const scopes = threadIds.map((threadId) => scopeOf(base.state, { threadId }));
  const threads = scopes.flatMap((s) => (s.thread ? [s.thread] : []));
  const items = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const action: PaletteAction | undefined = ACTIONS.find((a) => a.id === id);
      if (!action?.many) return [];
      const { applies, skipped } = splitByRule(action.when, scopes);
      return applies.length > 0 ? [{ action, many: action.many, skipped: skipped.flatMap((s) => (s.thread ? [s.thread] : [])) }] : [];
    });
  const shown = groups.map(items).filter((g) => g.length > 0);
  return (
    <>
      <ContextMenuLabel>{threads.length} threads selected</ContextMenuLabel>
      {shown.map((group) => (
        <Fragment key={group[0].action.id}>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            {group.map(({ action, many, skipped }) =>
              skipped.length > 0 ? (
                <SkippedItem key={action.id} action={action} title={many.title} reason={many.skipReason} skipped={skipped} />
              ) : (
                <ContextMenuItem key={action.id} onSelect={() => many.run(threads, { ...base, scope: scopes[0] })}>
                  <action.icon />
                  {many.title}
                </ContextMenuItem>
              ),
            )}
          </ContextMenuGroup>
        </Fragment>
      ))}
    </>
  );
}

// Not Radix `disabled`: that drops the item from keyboard focus and pointer events, so its reason could never show.
function SkippedItem({ action, title, reason, skipped }: { action: PaletteAction; title: string; reason: string; skipped: Thread[] }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ContextMenuItem aria-disabled onSelect={(e) => e.preventDefault()} className="opacity-50 focus:bg-transparent">
          <action.icon />
          {title}
        </ContextMenuItem>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-64">
        {skipped.map((t) => t.title).join(', ')}: {reason}
      </TooltipContent>
    </Tooltip>
  );
}

function ActionItem({ action, onSelect }: { action: PaletteAction; onSelect: () => void }) {
  return (
    <ContextMenuItem onSelect={onSelect}>
      <action.icon />
      {action.title}
      {!!action.shortcut && (
        <ContextMenuShortcut className="tracking-normal">
          <Shortcut keys={action.shortcut} />
        </ContextMenuShortcut>
      )}
    </ContextMenuItem>
  );
}
