import type { ComponentProps } from 'react';
import { DiagramTree } from '@/icons';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { parentOf } from '../reorder';
import { useHarness } from '../store';
import { unnestWithUndo } from '../subThreadActions';
import { ActionItems, BulkActionItems } from './ActionItems';
import { parseRemoteThreadId } from '../remote/ids';
import { REMOTE_THREAD_MENU, THREAD_MENU } from './menus';

/**
 * A sidebar thread row: the bulk menu when it is part of a multi-selection, else the thread's own menu. Extra props (a
 * wrapping HoverCardTrigger's handlers and ref) pass through to the row, so the pinned peek still opens.
 */
export function ThreadRowMenu({
  threadId,
  selectedIds,
  children,
  ...props
}: { threadId: string; selectedIds: string[] } & ComponentProps<
  typeof ContextMenuTrigger
>) {
  const isBulk = selectedIds.length > 1 && selectedIds.includes(threadId);
  const isRemote = (id: string) => !!parseRemoteThreadId(id);
  const groups = isRemote(threadId) ? REMOTE_THREAD_MENU : THREAD_MENU;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild {...props}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        {isBulk ? (
          <BulkActionItems
            threadIds={selectedIds}
            groups={
              selectedIds.some(isRemote) ? REMOTE_THREAD_MENU : THREAD_MENU
            }
          />
        ) : (
          <>
            <ActionItems target={{ threadId, isRow: true }} groups={groups} />
            {!isRemote(threadId) && <SubThreadItems threadId={threadId} />}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * A sub-thread can move out of its parent. Nothing nests from here: a sub-thread is one its parent's agent started, so its
 * reports, branch and PR fit that parent.
 */
function SubThreadItems({ threadId }: { threadId: string }) {
  const { state, dispatch } = useHarness();
  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread || thread.status === 'settled') return null;
  const parent = parentOf(state.threads, thread);
  if (!parent) return null;
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() => unnestWithUndo(dispatch, state.threads, thread)}
      >
        <DiagramTree />
        <span className="min-w-0 truncate">{`Move out of “${parent.title}”`}</span>
      </ContextMenuItem>
    </>
  );
}
