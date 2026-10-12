import type { ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu';
import { ActionItems, BulkActionItems } from './ActionItems';
import { THREAD_MENU } from './menus';

/** A sidebar thread row: the bulk menu when it is part of a multi-selection, else the thread's own menu. */
export function ThreadRowMenu({ threadId, selectedIds, children }: { threadId: string; selectedIds: string[]; children: ReactNode }) {
  const isBulk = selectedIds.length > 1 && selectedIds.includes(threadId);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">{isBulk ? <BulkActionItems threadIds={selectedIds} groups={THREAD_MENU} /> : <ActionItems target={{ threadId }} groups={THREAD_MENU} />}</ContextMenuContent>
    </ContextMenu>
  );
}
