import { useSidebar } from '@/components/ui/sidebar';

/** Phones carry a sidebar trigger in the first split's header; on desktop that header only clears the traffic lights while the sidebar is collapsed. Show/hide on desktop lives in the thread's ⋮ menu and the edge peek. */
export function useToggleSlot(isFirst: boolean) {
  const { state, isMobile } = useSidebar();
  return { hasTrigger: isFirst && isMobile, reservesLights: isFirst && !isMobile && state === 'collapsed' };
}

export const LIGHTS_RESERVE = 'in-data-traffic-lights:pl-20';
