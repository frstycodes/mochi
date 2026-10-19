import type { ComponentProps } from 'react';
import { DiagramTree } from '@/icons';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@/components/ui/context-menu';
import { nestBlocker, parentOf, sidebarGroups } from '../reorder';
import { useHarness } from '../store';
import { nestWithUndo, unnestWithUndo } from '../subThreadActions';
import { ActionItems, BulkActionItems } from './ActionItems';
import { THREAD_MENU } from './menus';

/**
 * A sidebar thread row: the bulk menu when it is part of a multi-selection, else the thread's own menu. Extra props (a
 * wrapping HoverCardTrigger's handlers and ref) pass through to the row, so the pinned peek still opens.
 */
export function ThreadRowMenu({ threadId, selectedIds, children, ...props }: { threadId: string; selectedIds: string[] } & ComponentProps<typeof ContextMenuTrigger>) {
  const isBulk = selectedIds.length > 1 && selectedIds.includes(threadId);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild {...props}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        {isBulk ? (
          <BulkActionItems threadIds={selectedIds} groups={THREAD_MENU} />
        ) : (
          <>
            <ActionItems target={{ threadId, isRow: true }} groups={THREAD_MENU} />
            <SubThreadItems threadId={threadId} />
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Nesting from the keyboard: a sub-thread moves out of its parent; any other row picks a parent from the space's top-level threads. */
function SubThreadItems({ threadId }: { threadId: string }) {
  const { state, dispatch } = useHarness();
  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread || thread.status === 'settled') return null;
  const parent = parentOf(state.threads, thread);
  if (parent)
    return (
      <>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => unnestWithUndo(dispatch, state.threads, thread)}>
          <DiagramTree />
          <span className="min-w-0 truncate">{`Move out of “${parent.title}”`}</span>
        </ContextMenuItem>
      </>
    );
  const { pinned, active } = sidebarGroups(state.threads, thread.spaceId);
  const parents = [...pinned, ...active].map((g) => g.thread).filter((t) => !nestBlocker(state.threads, thread.id, t.id));
  if (!parents.length) return null;
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <DiagramTree />
          Make sub-thread of
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-80 w-60 overflow-y-auto">
          {parents.map((p) => (
            <ContextMenuItem key={p.id} onSelect={() => nestWithUndo(dispatch, state.threads, thread, p.id)}>
              <span className="min-w-0 truncate">{p.title}</span>
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  );
}
