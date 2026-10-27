import { useEffect, useRef, useState, type RefObject } from 'react';
import { useReducedMotionConfig } from 'motion/react';
import { cn } from '@/lib/utils';
import type { Space } from './model';
import { HALO, HALO_SPAN, haloAlpha, haloMotion } from './haloShape';
import { idSeed, spaceColor, spaceColorCss } from './spaceColor';

/**
 * The current profile's halo along the bottom of the sidebar, crossfading on a switch. Absolute, so the sidebar must be
 * positioned, and whatever sits over it (content, footer) positioned too so it paints above.
 */
export function SpaceHalo({
  profiles,
  currentId,
}: {
  profiles: Space[];
  currentId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useDeviceSize(ref);
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 opacity-(--halo-strength)"
      style={{ height: `${HALO_SPAN * 100}%` }}
    >
      {profiles.map((space) => (
        <HaloLayer
          key={space.id}
          space={space}
          isCurrent={space.id === currentId}
          size={size}
        />
      ))}
    </div>
  );
}

type DeviceSize = { width: number; height: number };

// Only the current layer draws and moves; the others keep their last frame to fade out on, and redraw when they come back.
function HaloLayer({
  space,
  isCurrent,
  size,
}: {
  space: Space;
  isCurrent: boolean;
  size: DeviceSize | undefined;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const color = spaceColorCss(spaceColor(space));
  const isReduced = useReducedMotionConfig();
  const motion = isReduced ? 'still' : haloMotion(space);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !isCurrent || !size || !color) return;
    const seed = idSeed(space.id);
    const draw = (time: number) =>
      drawHalo(canvas, size, seed, color, {
        time,
        shift: motion === 'drift' ? time * HALO.drift : 0,
      });
    draw(0);
    if (motion === 'still') return;
    let frame = 0;
    let start: number | undefined;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      start ??= now;
      if (now - last < FRAME_MS) return;
      last = now;
      draw((now - start) / 1000);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isCurrent, size, color, space.id, motion]);
  return (
    <div
      className={cn(
        'absolute inset-0 opacity-0 transition-opacity duration-200',
        isCurrent && !!color && 'opacity-100',
      )}
    >
      <canvas
        ref={ref}
        className={cn(
          'absolute inset-0 size-full',
          isCurrent && motion === 'breathe' && 'halo-breathe',
        )}
      />
    </div>
  );
}

// 30fps: the edge moves a few pixels a second, so more frames only cost CPU.
const FRAME_MS = 1000 / 30;

function drawHalo(
  canvas: HTMLCanvasElement,
  { width, height }: DeviceSize,
  seed: number,
  color: string,
  at: { time: number; shift: number },
) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  const alpha = haloAlpha(width, height, seed, at);
  const image = context.createImageData(width, height);
  for (let i = 0; i < alpha.length; i++) image.data[i * 4 + 3] = alpha[i];
  context.putImageData(image, 0, 0);
  // Keeps the mask's alpha and takes the colour, so oklch() never has to be converted by hand.
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
}

function useDeviceSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<DeviceSize>();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.round(entry.contentRect.width * ratio);
      const height = Math.round(entry.contentRect.height * ratio);
      setSize((now) =>
        now?.width === width && now.height === height ? now : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
