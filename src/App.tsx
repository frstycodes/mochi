import { useCallback, useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { ThemeProvider } from 'next-themes';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/toast/Toaster';
import { useResolvedQueueToasts } from './QueueToast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DesignPage } from './design/DesignPage';
import { Orbit } from './Orbit';
import { useAppZoom } from './appZoom';
import { ZoomChip } from './ZoomChip';
import { host } from './host';
import { FileViewer } from './files/FileViewer';
import { PhotoViewer } from './photo/PhotoViewer';
import { AppSidebar, SidebarPeek } from './Sidebar';
import { useSidebarWidth } from './SidebarResizer';
import { PinnedPager } from './pager/PinnedPager';
import { TornWindow } from './stage/TornWindow';
import { CommandPalette } from './palette/CommandPalette';
import { useGlobalKeys } from './palette/useGlobalKeys';
import { ReviewModeProvider, useReviewMode } from './review/useReviewMode';
import { ReviewView } from './review/ReviewView';
import { useSettingsRoute } from './settings/open';
import { usePrefs } from './settings/prefs';
import { SettingsPage } from './settings/SettingsPage';
import { AgentSettingsProvider } from './settings/AgentSettings';
import { SettingsSidebar } from './settings/SettingsSidebar';
import { useSettingsShortcut } from './settings/useSettingsShortcut';
import { HarnessProvider, useHarness } from './store';
import { ScheduleLayer } from './schedule/ScheduleDialog';
import { RenameLayer } from './RenameDialog';
import { GoalEditorLayer } from './goals/GoalEditor';
import { useIdleScrollbars } from './useIdleScrollbars';
import { useAutoArchive } from './git/autoArchive';
import { useCheckoutRecovery, useWorktreeManager, useWorktreeCleanup } from './git/useWorktreeManager';
import { readEmbeddedReplay } from './replay/export';
import { useReplayRoute } from './replay/open';
import { ReplayPage, ReplayView } from './replay/ReplayView';
import { ColorThemeController } from './themes/ColorThemeController';
import { DeviceApprovalLayer } from './remote/DeviceApproval';
import { useRemoteThreadRoute } from './remote/open';
import { RemoteThreadView } from './remote/RemoteThreadView';
import { MachinesProvider } from './remote/useMachines';
import { useLibraryNamesLoader } from './library/useLibrary';

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
              <MachinesProvider>
                <ReviewModeProvider>
                  <Shell />
                </ReviewModeProvider>
              </MachinesProvider>
              <Orbit />
              <PhotoViewer />
              <FileViewer />
              <ScheduleLayer />
              <RenameLayer />
              <GoalEditorLayer />
              <DeviceApprovalLayer />
              <Toaster />
              <AppZoomChip />
            </HarnessProvider>
          )}
        </TooltipProvider>
      </ReducedMotion>
    </ThemeProvider>
  );
}

/** Rendered after the headers: Electron applies `app-region` in document order, so an earlier no-drag control under a drag header can't be clicked. */
function AppZoomChip() {
  const zoom = useAppZoom();
  return <ZoomChip zoom={zoom} onReset={() => void host.windows.resetZoom()} className="fixed top-2 left-1/2 z-50 -translate-x-1/2 app-no-drag" />;
}

/**
 * Settings › Appearance's Reduce motion: Motion components through MotionConfig, CSS through `data-reduce-motion` (the `motion-*` variants in index.css).
 * Its Animations go to CSS as `data-animations`.
 */
function ReducedMotion({ children }: { children: React.ReactNode }) {
  const { reduceMotion, animations } = usePrefs();
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = reduceMotion;
  }, [reduceMotion]);
  useEffect(() => {
    document.documentElement.dataset.animations = animations.join(' ');
  }, [animations]);
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
  useLibraryNamesLoader(useHarness().state.spaceId);
  useResolvedQueueToasts();
  useWorktreeManager();
  useCheckoutRecovery();
  useWorktreeCleanup();
  useAutoArchive();
  const review = useReviewMode();
  const isSettingsOpen = !!useSettingsRoute();
  const isReplayOpen = !!useReplayRoute();
  const isRemoteOpen = !!useRemoteThreadRoute();
  useSettingsShortcut();

  const content = (
    <SidebarProvider className="h-svh min-h-0" style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}>
      {/* `isolate`: the page's own z-indexed layers stay under the fixed sidebar while it slides over them; dialogs portal to body, outside it. */}
      <SidebarInset className="isolate order-last min-h-0 overflow-hidden">
        <div className="min-h-0 flex-1">
          {isSettingsOpen ? <SettingsPage /> : isReplayOpen ? <ReplayView /> : isRemoteOpen ? <RemoteThreadView /> : review.isOpen ? <ReviewView /> : <PinnedPager />}
        </div>
      </SidebarInset>
      {/* After the page in the DOM, back on the left through `order-last` above: Electron applies app-region in document order, so the page's drag headers would otherwise swallow the sidebar's toggle. */}
      {isSettingsOpen ? (
        <SettingsSidebar width={sidebarWidth} onResize={setSidebarWidth} />
      ) : (
        <>
          <AppSidebar onSearch={() => setSearchOpen(true)} width={sidebarWidth} onResize={setSidebarWidth} />
          <SidebarPeek onSearch={() => setSearchOpen(true)} />
        </>
      )}
      <CommandPalette open={isSearchOpen} onOpenChange={setSearchOpen} />
    </SidebarProvider>
  );
  return isSettingsOpen ? <AgentSettingsProvider>{content}</AgentSettingsProvider> : content;
}
