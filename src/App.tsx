import { useCallback, useEffect, useRef, useState } from 'react';
import { ThemeProvider } from 'next-themes';
import { Edit, Grid, Inbox, Route } from 'reicon-react';
import { toast } from 'sonner';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SPACES } from './model';
import { DesignPage } from './design/DesignPage';
import { Orbit } from './Orbit';
import { AppSidebar, SidebarPeek } from './Sidebar';
import { useSidebarWidth } from './SidebarResizer';
import { PRESETS, PRESET_LABELS } from './layout/tree';
import { Workspace } from './layout/Workspace';
import { HarnessProvider, useHarness, type Action, type View } from './store';
import { useIdleScrollbars } from './useIdleScrollbars';
import { StepStatusIcon, ThreadStatusIcon, lineColor } from './ui';

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
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();
  const toggleSearch = useCallback(() => setSearchOpen((o) => !o), []);
  useGlobalKeys(toggleSearch);
  useOverlapToasts();

  return (
    <SidebarProvider className="h-svh min-h-0" style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}>
      <AppSidebar onSearch={() => setSearchOpen(true)} width={sidebarWidth} onResize={setSidebarWidth} />
      <SidebarPeek onSearch={() => setSearchOpen(true)} />
      <SidebarInset className="min-h-0 overflow-hidden">
        <div className="min-h-0 flex-1">
          <Workspace />
        </div>
      </SidebarInset>
      <SearchPalette open={isSearchOpen} onOpenChange={setSearchOpen} />
    </SidebarProvider>
  );
}

function SearchPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { state, dispatch } = useHarness();
  const run = (action: Action) => {
    dispatch(action);
    onOpenChange(false);
  };
  const go = (view: View) => run({ type: 'go', view });
  const spaceName = (id: string) => SPACES.find((s) => s.id === id)?.name;
  const liveSteps = state.threads
    .filter((t) => t.spaceId === state.spaceId && t.status !== 'settled')
    .flatMap((t) => t.steps.filter((s) => s.status !== 'done' && s.status !== 'dropped').map((step) => ({ thread: t, step })));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Jump to a thread, step or view">
      <Command>
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
          <CommandGroup heading="Layout">
            {PRESETS.map((p) => (
              <CommandItem key={p} value={`Layout ${PRESET_LABELS[p]}`} onSelect={() => run({ type: 'layout-preset', preset: p })}>
                <Grid />
                Layout: {PRESET_LABELS[p]}
              </CommandItem>
            ))}
            <CommandItem value="Split rotate" onSelect={() => run({ type: 'layout-rotate' })}>
              <Grid />
              Rotate the focused split
            </CommandItem>
            <CommandItem value="Split swap" onSelect={() => run({ type: 'layout-swap' })}>
              <Grid />
              Swap the focused split with the next
            </CommandItem>
            <CommandItem value="Split zoom maximize" onSelect={() => run({ type: 'layout-zoom' })}>
              <Grid />
              Zoom the focused split
              <CommandShortcut>Shift Cmd Enter</CommandShortcut>
            </CommandItem>
            <CommandItem value="Split close" onSelect={() => run({ type: 'layout-close' })}>
              <Grid />
              Close the focused split
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
      </Command>
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
