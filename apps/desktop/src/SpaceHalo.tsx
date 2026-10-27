import { useEffect, useRef, useState, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import type { Space } from './model';
import { HALO_SPAN, haloAlpha, haloMotion } from './haloShape';
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
  const motion = haloMotion(space);
  const widths = motion === 'drift' ? 2 : 1;
  useEffect(() => {
    if (!ref.current || !isCurrent || !size || !color) return;
    drawHalo(ref.current, size, idSeed(space.id), color, widths);
  }, [isCurrent, size, color, space.id, widths]);
  return (
    <div
      className={cn(
        'absolute inset-0 overflow-hidden opacity-0 transition-opacity duration-200',
        isCurrent && !!color && 'opacity-100',
      )}
    >
      <canvas
        ref={ref}
        className={cn(
          'absolute inset-y-0 left-0 h-full w-full',
          widths === 2 && 'w-[200%]',
          isCurrent && motion === 'breathe' && 'motion-safe:halo-breathe',
          isCurrent && motion === 'drift' && 'motion-safe:halo-drift',
        )}
      />
    </div>
  );
}

function drawHalo(
  canvas: HTMLCanvasElement,
  size: DeviceSize,
  seed: number,
  color: string,
  widths: number,
) {
  const width = size.width * widths;
  const { height } = size;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  const alpha = haloAlpha(width, height, seed, widths);
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
