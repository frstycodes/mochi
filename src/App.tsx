import { useCallback, useEffect, useRef, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { ThemeProvider } from 'next-themes';
import { toast } from 'sonner';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DesignPage } from './design/DesignPage';
import { Orbit } from './Orbit';
import { FileViewer } from './files/FileViewer';
import { PhotoViewer } from './photo/PhotoViewer';
import { AppSidebar, SidebarPeek } from './Sidebar';
import { useSidebarWidth } from './SidebarResizer';
import { SidebarToggle } from './SidebarToggle';
import { PinnedPager } from './pager/PinnedPager';
import { TornWindow } from './stage/TornWindow';
import { CommandPalette } from './palette/CommandPalette';
import { useGlobalKeys } from './palette/useGlobalKeys';
import { ReviewModeProvider, useReviewMode } from './review/useReviewMode';
import { ReviewView } from './review/ReviewView';
import { useSettingsRoute } from './settings/open';
import { usePrefs } from './settings/prefs';
import { SettingsPage } from './settings/SettingsPage';
import { SettingsSidebar } from './settings/SettingsSidebar';
import { useSettingsShortcut } from './settings/useSettingsShortcut';
import { HarnessProvider, useHarness } from './store';
import { ScheduleLayer } from './schedule/ScheduleDialog';
import { GoalEditorLayer } from './goals/GoalEditor';
import { useIdleScrollbars } from './useIdleScrollbars';
import { useCheckoutRecovery, useWorktreeManager, useWorktreeCleanup } from './git/useWorktreeManager';
import { readEmbeddedReplay } from './replay/export';
import { useReplayRoute } from './replay/open';
import { ReplayPage, ReplayView } from './replay/ReplayView';
import { ColorThemeController } from './themes/ColorThemeController';

// An exported replay page (`src/replay/page.ts`): the app shows only that replay, with no store of its own.
const embeddedReplay = readEmbeddedReplay();

export function App() {
  const route = useHashRoute();
  useIdleScrollbars();
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ColorThemeController />
      <ReducedMotion>
        <TooltipProvider delayDuration={400}>
          {embeddedReplay ? (
            <ReplayPage payload={embeddedReplay} />
          ) : route === 'design' ? (
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
              <FileViewer />
              <ScheduleLayer />
              <GoalEditorLayer />
              <Toaster position="bottom-right" />
            </HarnessProvider>
          )}
        </TooltipProvider>
      </ReducedMotion>
    </ThemeProvider>
  );
}

/** Settings › General's Reduce motion: Motion components through MotionConfig, CSS through `data-reduce-motion` (the `motion-*` variants in index.css). */
function ReducedMotion({ children }: { children: React.ReactNode }) {
  const { reduceMotion } = usePrefs();
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = reduceMotion;
  }, [reduceMotion]);
  return <MotionConfig reducedMotion={MOTION_CONFIG[reduceMotion]}>{children}</MotionConfig>;
}

const MOTION_CONFIG = { system: 'user', on: 'always', off: 'never' } as const;

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
  useCheckoutRecovery();
  useWorktreeCleanup();
  const review = useReviewMode();
  const isSettingsOpen = !!useSettingsRoute();
  const isReplayOpen = !!useReplayRoute();
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
      <SidebarInset className="min-h-0 overflow-hidden">
        <div className="min-h-0 flex-1">
          {isSettingsOpen ? <SettingsPage /> : isReplayOpen ? <ReplayView /> : review.isOpen ? <ReviewView /> : <PinnedPager />}
        </div>
      </SidebarInset>
      <CommandPalette open={isSearchOpen} onOpenChange={setSearchOpen} />
      {/* Last on purpose: Electron applies app-region in document order, so the headers' drag regions after it would swallow its clicks. */}
      <SidebarToggle />
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
