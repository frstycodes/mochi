import type { ClipboardEvent, KeyboardEvent, PointerEvent } from 'react';
import { host } from '@/host';
import type { Simulator, SimTouchPhase } from '@/host/types/sim';
import { cn } from '@/lib/utils';

// Non-printing keys → HID usage (keyboard page 7).
const KEY_USAGES: Record<string, number> = {
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
};

// Screen corner radius as a share of the screen width; iPads are far squarer than iPhones.
const CORNER = { iphone: 0.13, ipad: 0.03 } satisfies Record<
  Simulator['family'],
  number
>;

/** The live screen: pointer drags become touches, focused keystrokes become typing. */
export function DeviceScreen({
  device,
  frameUrl,
  size,
  className,
}: {
  device: Simulator;
  frameUrl: string;
  size: { width: number; height: number };
  className?: string;
}) {
  const corner = CORNER[device.family] * 100;

  return (
    <img
      src={frameUrl}
      alt={`${device.name} screen`}
      tabIndex={0}
      draggable={false}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        touch(e, 'down', device.udid);
      }}
      onPointerMove={(e) =>
        e.currentTarget.hasPointerCapture(e.pointerId) &&
        touch(e, 'move', device.udid)
      }
      onPointerUp={(e) => touch(e, 'up', device.udid)}
      onPointerCancel={(e) => touch(e, 'up', device.udid)}
      onKeyDown={(e) => typeKey(e, device.udid)}
      onPaste={(e) => paste(e, device.udid)}
      style={{
        aspectRatio: `${size.width} / ${size.height}`,
        borderRadius: `${corner}% / ${(corner * size.width) / size.height}%`,
      }}
      className={cn(
        'max-h-full max-w-full cursor-pointer touch-none bg-black object-contain outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    />
  );
}

function touch(
  e: PointerEvent<HTMLImageElement>,
  phase: SimTouchPhase,
  udid: string,
) {
  const rect = e.currentTarget.getBoundingClientRect();
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  host.sim
    .touch(
      udid,
      phase,
      clamp((e.clientX - rect.left) / rect.width),
      clamp((e.clientY - rect.top) / rect.height),
    )
    .catch(() => {});
}

function typeKey(e: KeyboardEvent<HTMLImageElement>, udid: string) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const usage = KEY_USAGES[e.key];
  if (usage === undefined && e.key.length !== 1) return;
  e.preventDefault();
  (usage === undefined
    ? host.sim.type(udid, e.key)
    : host.sim.key(udid, usage)
  ).catch(() => {});
}

function paste(e: ClipboardEvent<HTMLImageElement>, udid: string) {
  const text = e.clipboardData.getData('text/plain');
  if (!text) return;
  e.preventDefault();
  host.sim.type(udid, text).catch(() => {});
}
