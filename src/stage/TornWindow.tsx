import { useEffect } from 'react';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';
import { host } from '@/host';
import { cn } from '@/lib/utils';
import { LeafView } from '../layout/Workspace';
import { useThread } from '../store';
import { DragStrip } from '../TitleBar';
import { MirrorProvider } from './windowSync';

/** A split torn into its own OS window (or browser tab): one thread, mirrored from the main window's store. */
export function TornWindow({ threadId }: { threadId: string }) {
  return (
    <MirrorProvider fallback={<Waiting />}>
      <SidebarProvider defaultOpen={false} className="h-svh min-h-0">
        <TornThread threadId={threadId} />
      </SidebarProvider>
    </MirrorProvider>
  );
}

function TornThread({ threadId }: { threadId: string }) {
  const thread = useThread(threadId);
  useEffect(() => {
    if (thread) document.title = thread.title;
  }, [thread?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!thread) return <Gone />;
  return (
    // Desktop windows hide the title bar: with no sidebar here, the header clears the traffic lights itself.
    <main className={cn('h-full min-w-0 flex-1', host.isDesktop && '[&_header]:pl-20')}>
      <LeafView leaf={{ kind: 'leaf', id: 'window', view: { kind: 'thread', id: threadId } }} isMulti={false} isZoomed={false} isFirst={false} />
    </main>
  );
}

function Waiting() {
  return (
    <Empty className="relative h-svh">
      <DragStrip />
      <EmptyHeader>
        <Spinner />
        <EmptyTitle>Connecting to the main window</EmptyTitle>
        <EmptyDescription>This window shows a thread from the main Mochi window. Keep that one open.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function Gone() {
  return (
    <Empty className="relative h-full flex-1">
      <DragStrip />
      <EmptyHeader>
        <EmptyTitle>This thread is gone</EmptyTitle>
        <EmptyDescription>It was deleted in the main window. Close this window.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
