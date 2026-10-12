import { Fragment } from 'react';
import { ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut } from '@/components/ui/context-menu';
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ACTIONS, type PaletteAction } from '../palette/actions';
import { scopeOf, splitByRule, type ScopeTarget } from '../palette/when';
import { useActionContext, useActions } from '../palette/useActions';
import { Shortcut } from '../Shortcut';
import { useReviewerChecks } from '../secondOpinion/reviewer';

type Groups = readonly (readonly string[])[];

/** The same items in a right-click menu or a dropdown (a header's ⋯). The tooltip side points away from where each menu opens. */
const MENU_PARTS = {
  context: { Group: ContextMenuGroup, Item: ContextMenuItem, Separator: ContextMenuSeparator, Shortcut: ContextMenuShortcut, tooltipSide: 'right' },
  dropdown: { Group: DropdownMenuGroup, Item: DropdownMenuItem, Separator: DropdownMenuSeparator, Shortcut: DropdownMenuShortcut, tooltipSide: 'left' },
} as const;
type MenuKind = keyof typeof MENU_PARTS;

/** Registry actions for one target as context menu items, in the given groups; unavailable ones drop out, empty groups and their separators too. */
export function ActionItems({ target, groups, menu = 'context' }: { target: ScopeTarget; groups: Groups; menu?: MenuKind }) {
  const { Group, Separator } = MENU_PARTS[menu];
  const { actions, run, scope } = useActions(target);
  useReviewerChecks();
  // Action ids are plain strings: a typo would silently drop the item, so dev builds fail loudly instead.
  if (import.meta.env.DEV) groups.flat().forEach((id) => ACTIONS.some((a) => a.id === id) || console.error(`Context menu lists unknown action "${id}"`));
  const shown = groups.map((ids) => ids.flatMap((id) => actions.filter((a) => a.id === id))).filter((g) => g.length > 0);
  return shown.map((group, i) => (
    <Fragment key={group[0].id}>
      {i > 0 && <Separator />}
      <Group>
        {group.map((action) => {
          const title = action.label?.(scope) ?? action.title;
          const reason = action.disabledReason?.(scope);
          return reason ? <SkippedItem key={action.id} menu={menu} action={action} title={title} reason={reason} /> : <ActionItem key={action.id} menu={menu} action={action} title={title} onSelect={() => run(action)} />;
        })}
      </Group>
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
                <SkippedItem key={action.id} menu="context" action={action} title={many.title} reason={`${skipped.map((t) => t.title).join(', ')}: ${many.skipReason}`} />
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
function SkippedItem({ menu, action, title, reason }: { menu: MenuKind; action: PaletteAction; title: string; reason: string }) {
  const { Item, tooltipSide } = MENU_PARTS[menu];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Item aria-disabled onSelect={(e) => e.preventDefault()} className="opacity-50 focus:bg-transparent">
          <action.icon />
          {title}
        </Item>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="max-w-64">
        {reason}
      </TooltipContent>
    </Tooltip>
  );
}

function ActionItem({ menu, action, title, onSelect }: { menu: MenuKind; action: PaletteAction; title: string; onSelect: () => void }) {
  const { Item, Shortcut: ItemShortcut } = MENU_PARTS[menu];
  return (
    <Item onSelect={onSelect}>
      <action.icon />
      {title}
      {!!action.shortcut && (
        <ItemShortcut className="tracking-normal">
          <Shortcut keys={action.shortcut} />
        </ItemShortcut>
      )}
    </Item>
  );
}
