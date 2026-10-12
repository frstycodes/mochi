import { useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { TOGGLE_RESERVE, useToggleSlot } from '../SidebarToggle';
import { AgentSettingsProvider } from './AgentSettings';
import { closeSettings, useSettingsRoute, type SettingsRoute } from './open';
import { prefersReducedMotion } from './prefs';
import { SETTINGS_SECTIONS } from './sections';

/** The content column while settings are open: one section, scrolling on its own. */
export function SettingsPage() {
  const route = useSettingsRoute();
  const section = SETTINGS_SECTIONS.find((s) => s.id === route?.section) ?? SETTINGS_SECTIONS[0];
  const Section = section.component;
  const { hasTrigger, reservesToggle } = useToggleSlot(true);
  useEscapeBack();
  useFlashSetting(route);

  return (
    <AgentSettingsProvider>
      {/* Grid, not flex: the scroll viewport's height: 100% only resolves against a definite grid track. */}
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <header className={cn('flex h-11 items-center gap-2 px-4', reservesToggle && TOGGLE_RESERVE)}>
          {hasTrigger && <SidebarTrigger className="-ml-1 text-muted-foreground" />}
          <h1 className="truncate type-title">{section.title}</h1>
        </header>
        <ScrollArea type="scroll" className="min-h-0">
          <div className="mx-auto w-full max-w-2xl px-4 pt-2 pb-12 md:px-6"><Section /></div>
        </ScrollArea>
      </div>
    </AgentSettingsProvider>
  );
}

/** Esc goes back to the app, unless it's closing a menu or popover first, or leaving a text field (then a second Esc goes back). */
function useEscapeBack() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[data-radix-popper-content-wrapper], [role=dialog], [role=alertdialog]')) return;
      const target = e.target as HTMLElement;
      if (target.matches?.('input, textarea, select')) return void target.blur();
      closeSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const FLASH_MS = 1200;

/** Deep links scroll to their row and flash it; rows that wait on loaded settings get a few frames to appear. */
function useFlashSetting(route: SettingsRoute | null) {
  useEffect(() => {
    if (!route?.settingId) return;
    let frame = 0;
    let timer = 0;
    const startedAt = performance.now();
    const find = () => {
      const row = document.querySelector<HTMLElement>(`[data-setting-id="${route.settingId}"]`);
      if (!row) {
        if (performance.now() - startedAt < 2000) frame = requestAnimationFrame(find);
        return;
      }
      const smooth = !prefersReducedMotion();
      row.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
      row.dataset.flash = '';
      timer = window.setTimeout(() => delete row.dataset.flash, FLASH_MS);
    };
    find();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [route?.nonce, route?.settingId]);
}
