import { useCallback, useEffect, useRef, useState } from 'react';
import { ThemeProvider } from 'next-themes';
import { Edit, Inbox, Route } from 'reicon-react';
import { toast } from 'sonner';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SPACES, type Space } from './model';
import { BoardView } from './BoardView';
import { DesignPage } from './design/DesignPage';
import { NewThreadView } from './NewThreadView';
import { Orbit } from './Orbit';
import { QueueView } from './QueueView';
import { AppSidebar, SidebarPeek } from './Sidebar';
import { useSidebarWidth } from './SidebarResizer';
import { HarnessProvider, useHarness, useSpace, useView, type View } from './store';
import { ThreadView } from './ThreadView';
import { useIdleScrollbars } from './useIdleScrollbars';
import { useWorktreeManager } from './git/useWorktreeManager';
import { SpaceIcon, StepStatusIcon, ThreadStatusIcon, lineColor } from './ui';

export function App() {
  const route = useHashRoute();
  useIdleScrollbars();
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={400}>
        {route === 'design' ? (
          <DesignPage />
        ) : (
          <HarnessProvider>
            <Shell />
            <Orbit />
            <Toaster position="bottom-right" />
          </HarnessProvider>
        )}
      </TooltipProvider>
    </ThemeProvider>
  );
}

function useHashRoute() {
  const [hash, setHash] = useState(() => location.hash.slice(1));
  useEffect(() => {
    const onHash = () => setHash(location.hash.slice(1));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return hash;
}

function Shell() {
  const [isSearchOpen, setSearchOpen] = useState(false);
  const space = useSpace();
  const view = useView();
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
  const toggleSearch = useCallback(() => setSearchOpen((o) => !o), []);
  useGlobalKeys(toggleSearch);
  useOverlapToasts();
  useWorktreeManager();

  return (
    <SidebarProvider className="h-svh min-h-0" style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}>
      <AppSidebar onSearch={() => setSearchOpen(true)} width={sidebarWidth} onResize={setSidebarWidth} />
      <SidebarPeek onSearch={() => setSearchOpen(true)} />
      <SidebarInset className="min-h-0 overflow-hidden">
        {view.kind !== 'thread' && <ContentTopBar space={space} />}
        <div className="min-h-0 flex-1">
          <CurrentView />
        </div>
      </SidebarInset>
      <SearchPalette open={isSearchOpen} onOpenChange={setSearchOpen} />
    </SidebarProvider>
  );
}

function ContentTopBar({ space }: { space: Space }) {
  const { state, isMobile } = useSidebar();
  if (!isMobile && state === 'expanded') return null;
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-3">
      <SidebarTrigger className="-ml-1" />
      <SpaceIcon space={space} className="size-4 text-muted-foreground" />
      <span className="type-meta font-medium">{space.name}</span>
    </div>
  );
}

function CurrentView() {
  const view = useView();
  const { state } = useHarness();
  if (view.kind === 'queue') return <QueueView />;
  if (view.kind === 'board') return <BoardView />;
  if (view.kind === 'new') return <NewThreadView />;
  const thread = state.threads.find((t) => t.id === view.id);
  if (!thread) return <QueueView />;
  return <ThreadView thread={thread} />;
}

function SearchPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { state, dispatch } = useHarness();
  const go = (view: View) => {
    dispatch({ type: 'go', view });
    onOpenChange(false);
  };
  const spaceName = (id: string) => SPACES.find((s) => s.id === id)?.name;
  const liveSteps = state.threads
    .filter((t) => t.spaceId === state.spaceId && t.status !== 'settled')
    .flatMap((t) => t.steps.filter((s) => s.status !== 'done' && s.status !== 'dropped').map((step) => ({ thread: t, step })));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Jump to a thread, step or view">
      <CommandInput placeholder="Jump to a thread, step or view" />
      <CommandList>
        <CommandEmpty>Nothing matches. Try a thread title or a step name.</CommandEmpty>
        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => go({ kind: 'queue' })}>
            <Inbox />
            Queue
          </CommandItem>
          <CommandItem onSelect={() => go({ kind: 'board' })}>
            <Route />
            Board
          </CommandItem>
          <CommandItem onSelect={() => go({ kind: 'new' })}>
            <Edit />
            New thread
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Threads">
          {state.threads.map((t) => (
            <CommandItem key={t.id} value={`${t.title} ${t.repo?.branch ?? ''}`} onSelect={() => go({ kind: 'thread', id: t.id })}>
              <ThreadStatusIcon status={t.status} />
              <span className="truncate">{t.title}</span>
              <CommandShortcut className="tracking-normal">{spaceName(t.spaceId)}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Steps in this space">
          {liveSteps.map(({ thread, step }) => (
            <CommandItem key={step.id} value={`${step.title} ${thread.title}`} onSelect={() => go({ kind: 'thread', id: thread.id })}>
              <StepStatusIcon status={step.status} />
              <span className="truncate">{step.title}</span>
              <span aria-hidden className="ml-auto size-2 shrink-0 rounded-full" style={{ background: lineColor(thread.line) }} />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

function useGlobalKeys(onSearch: () => void) {
  const { dispatch } = useHarness();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onSearch();
        return;
      }
      if (e.ctrlKey && /^Digit[1-3]$/.test(e.code)) {
        e.preventDefault();
        dispatch({ type: 'space', id: SPACES[Number(e.code.slice(5)) - 1].id });
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [role=dialog]')) return;
      if (e.key === 'n') {
        e.preventDefault();
        dispatch({ type: 'go', view: { kind: 'new' } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, onSearch]);
}

function useOverlapToasts() {
  const { state, dispatch } = useHarness();
  const seen = useRef(new Set(state.queue.map((q) => q.id)));
  useEffect(() => {
    for (const q of state.queue) {
      if (seen.current.has(q.id)) continue;
      seen.current.add(q.id);
      if (q.kind !== 'overlap') continue;
      toast('Overlap caught before any duplicate work', {
        description: q.title,
        action: { label: 'Decide', onClick: () => dispatch({ type: 'go', view: { kind: 'queue' } }) },
      });
    }
  }, [state.queue, dispatch]);
}
