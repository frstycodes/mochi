import { useSidebar } from '@/components/ui/sidebar';
import { displayRoot, leaves } from '@mochi/domain/layout/tree';
import { useHarnessSelector } from './store';

/** A page header carries the sidebar trigger while the sidebar is hidden (always on phones, where it's a sheet), never once several splits are on screen. While collapsed on desktop, the first header also clears the traffic lights. */
export function useToggleSlot(isFirst: boolean, isMulti: boolean) {
  const { state, isMobile } = useSidebar();
  const isCollapsed = state === 'collapsed' && !isMobile;
  return {
    hasTrigger: isFirst && (isMobile || (isCollapsed && !isMulti)),
    clearsLights: isFirst && isCollapsed,
  };
}

/** Several splits on screen (zoomed counts, like `SplitInfo.isMulti`): the sidebar drops its trigger too. */
export function useIsMultiSplit() {
  return useHarnessSelector(
    (s) => leaves(displayRoot(s.layouts[s.spaceId], s.orientation)).length > 1,
  );
}

// An even 9px from the traffic lights to the trigger, matching the sidebar header's.
export const LIGHTS_RESERVE =
  'in-data-traffic-lights:pl-[calc(var(--lights-end)+9px)]';
