import { Fragment } from 'react';
import { ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut } from '@/components/ui/context-menu';
import { ACTIONS, type PaletteAction } from '../palette/actions';
import type { ScopeTarget } from '../palette/when';
import { useActions } from '../palette/useActions';
import { Shortcut } from '../Shortcut';

/** Registry actions for one target as context menu items, in the given groups; unavailable ones drop out, empty groups and their separators too. */
export function ActionItems({ target, groups }: { target: ScopeTarget; groups: readonly (readonly string[])[] }) {
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
