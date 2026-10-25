import { useEffect } from 'react';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { SidebarProvider } from '@/components/ui/sidebar';
import { host } from '@/host';
import { cn } from '@/lib/utils';
import { LeafView } from '../layout/Workspace';
import { useLibraryNamesLoader } from '../library/useLibrary';
import { StoreProvider, useThread } from '../store';
import { DragStrip } from '../TitleBar';

/** A split torn into its own OS window (or browser tab): one thread, from the same stream as the main window's store. */
export function TornWindow({ threadId }: { threadId: string }) {
  return (
    <StoreProvider>
      <SidebarProvider defaultOpen={false} className="h-svh min-h-0">
        <TornThread threadId={threadId} />
      </SidebarProvider>
    </StoreProvider>
  );
}

function TornThread({ threadId }: { threadId: string }) {
  const thread = useThread(threadId);
  useLibraryNamesLoader(thread?.spaceId);
  const title = thread?.title;
  useEffect(() => {
    if (title !== undefined) document.title = title;
  }, [title]);
  if (!thread) return <Gone />;
  return (
    // Desktop windows hide the title bar: with no sidebar here, the header clears the traffic lights itself.
    <main
      className={cn(
        'h-full min-w-0 flex-1',
        host.isDesktop && '[&_header]:pl-20',
      )}
    >
      <LeafView
        leaf={{
          kind: 'leaf',
          id: 'window',
          view: { kind: 'thread', id: threadId },
        }}
        isMulti={false}
        isZoomed={false}
        isFirst={false}
      />
    </main>
  );
}

function Gone() {
  return (
    <Empty className="relative h-full flex-1">
      <DragStrip />
      <EmptyHeader>
        <EmptyTitle>This thread is gone</EmptyTitle>
        <EmptyDescription>It was deleted. Close this window.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
