import type { LightsPlacement } from './host/types/windows';
import { host } from './host';
import { IS_MAC } from './keys';
import { useHasFocus } from './lib/windowFocus';
import { cn } from '@/lib/utils';

const HAS_LIGHTS = host.isDesktop && IS_MAC;

/** Moves the macOS traffic lights with the sidebar. While they're hidden, `data-lights-hidden` on <html> drops the page headers' inset for them; the sidebar's own headers keep theirs for when the peek brings them back. */
export function placeLights(placement: LightsPlacement) {
  if (!HAS_LIGHTS) return;
  void host.windows.placeLights(placement);
  document.documentElement.toggleAttribute(
    'data-lights-hidden',
    placement === 'hidden',
  );
}

// macOS's own close / minimize / zoom fills.
const LIGHT_COLORS = ['bg-[#ff5f57]', 'bg-[#febc2e]', 'bg-[#28c840]'];

/**
 * A drawn copy of the traffic lights for the hover peek's header, exactly where the native ones land (`trafficLightsAt` in
 * `electron/window.ts`: x 16, 14px each, ending at `--lights-end`, centred on the 44px header; native px, so divided by
 * the zoom). Native buttons can't follow a CSS slide, so the copy slides with the panel and the real ones appear over it
 * once it settles. Gone in full screen, where macOS has no lights there.
 */
export function LightsStandIn() {
  const hasFocus = useHasFocus();
  if (!HAS_LIGHTS) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 left-[calc(16px/var(--app-zoom,1))] z-10 hidden h-11 w-[calc(var(--lights-end)-16px/var(--app-zoom,1))] items-center justify-between in-data-traffic-lights:flex"
    >
      {LIGHT_COLORS.map((color) => (
        <span
          key={color}
          className={cn(
            'size-[calc(14px/var(--app-zoom,1))] rounded-full',
            hasFocus ? color : 'bg-muted-foreground/30',
          )}
        />
      ))}
    </div>
  );
}
