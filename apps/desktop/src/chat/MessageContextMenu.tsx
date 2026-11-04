import type { PointerEvent, ReactElement } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { SkippedItem } from '../menus/ActionItems';
import type { Thread } from '../model';
import { useMessageActions } from './MessageActions';

/** Right-click on a message, or Shift F10 from its action bar: the same actions as the hover bar. Selected text keeps the native menu. */
export function MessageContextMenu({
  thread,
  index,
  children,
}: {
  thread: Thread;
  index: number;
  children: ReactElement;
}) {
  const actions = useMessageActions(thread, index);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={children}
        className="select-text"
        onPointerDown={leaveLongPressToOrbit}
      />
      <ContextMenuContent className="w-52">
        {actions.map((a) =>
          a.disabledReason ? (
            <SkippedItem
              key={a.id}
              menu="context"
              icon={<a.icon />}
              title={a.label}
              reason={a.disabledReason}
            />
          ) : (
            <ContextMenuItem key={a.id} onClick={a.run}>
              <a.icon />
              {a.label}
            </ContextMenuItem>
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Touch long-press on a message belongs to Orbit and the OS text selection; preventDefault stops Radix starting its own timer.
function leaveLongPressToOrbit(e: PointerEvent) {
  if (e.pointerType !== 'mouse') e.preventDefault();
}
