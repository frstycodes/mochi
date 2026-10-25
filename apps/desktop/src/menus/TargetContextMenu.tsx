import type { ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { ScopeTarget } from '../palette/when';
import { ActionItems } from './ActionItems';

/** Right-click, the menu key or Shift F10 on `children`: the registry actions in `groups`, acting on `target` whether or not it is focused. */
export function TargetContextMenu({
  target,
  groups,
  children,
}: {
  target: ScopeTarget;
  groups: readonly (readonly string[])[];
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ActionItems target={target} groups={groups} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
