import { useCallback, useEffect, useRef, useState } from 'react';
import { ThemeProvider } from 'next-themes';
import { toast } from 'sonner';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DesignPage } from './design/DesignPage';
import { Orbit } from './Orbit';
import { PhotoViewer } from './photo/PhotoViewer';
import { AppSidebar, SidebarPeek } from './Sidebar';
import { useSidebarWidth } from './SidebarResizer';
import { SidebarToggle } from './SidebarToggle';
import { Stage } from './stage/Stage';
import { TornWindow } from './stage/TornWindow';
import { CommandPalette } from './palette/CommandPalette';
import { useGlobalKeys } from './palette/useGlobalKeys';
import { ReviewModeProvider, useReviewMode } from './review/useReviewMode';
import { ReviewView } from './review/ReviewView';
import { useSettingsRoute } from './settings/open';
import { SettingsPage } from './settings/SettingsPage';
import { SettingsSidebar } from './settings/SettingsSidebar';
import { useSettingsShortcut } from './settings/useSettingsShortcut';
import { HarnessProvider, useHarness } from './store';
import { useIdleScrollbars } from './useIdleScrollbars';
import { useWorktreeManager } from './git/useWorktreeManager';

export function App() {
  const route = useHashRoute();
  useIdleScrollbars();
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={400}>
        {route === 'design' ? (
          <DesignPage />
        ) : route.startsWith('/window/') ? (
          <TornWindow threadId={route.slice('/window/'.length)} />
        ) : (
          <HarnessProvider>
            <ReviewModeProvider>
              <Shell />
            </ReviewModeProvider>
            <Orbit />
            <PhotoViewer />
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
  useWorktreeManager();
  const review = useReviewMode();
  const isSettingsOpen = !!useSettingsRoute();
  useSettingsShortcut();

  return (
    <SidebarProvider className="h-svh min-h-0" style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}>
      {isSettingsOpen ? (
        <SettingsSidebar width={sidebarWidth} onResize={setSidebarWidth} />
      ) : (
        <>
          <AppSidebar onSearch={() => setSearchOpen(true)} width={sidebarWidth} onResize={setSidebarWidth} />
          <SidebarPeek onSearch={() => setSearchOpen(true)} />
        </>
      )}
      <SidebarToggle />
      <SidebarInset className="min-h-0 overflow-hidden">
        <div className="min-h-0 flex-1">
          {isSettingsOpen ? <SettingsPage /> : review.isOpen ? <ReviewView /> : <Stage />}
        </div>
      </SidebarInset>
      <CommandPalette open={isSearchOpen} onOpenChange={setSearchOpen} />
    </SidebarProvider>
  );
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
