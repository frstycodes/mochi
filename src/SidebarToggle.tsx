import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';

/** One toggle for open and collapsed alike, fixed where the sidebar header has it, so it never jumps between the sidebar and the thread header. */
export function SidebarToggle() {
  const { isMobile } = useSidebar();
  if (isMobile) return null;
  return <SidebarTrigger className="fixed top-2.5 left-2 z-50 text-muted-foreground in-data-traffic-lights:left-22" />;
}

/** Phones carry their own trigger in the first split's header; on desktop that header only keeps the fixed toggle's spot clear while the sidebar is collapsed. */
export function useToggleSlot(isFirst: boolean) {
  const { state, isMobile } = useSidebar();
  return { hasTrigger: isFirst && isMobile, reservesToggle: isFirst && !isMobile && state === 'collapsed' };
}

export const TOGGLE_RESERVE = 'pl-10 in-data-traffic-lights:pl-30';
