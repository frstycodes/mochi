import { useReducedMotionConfig } from 'motion/react';
import { useEffect, useEffectEvent, useRef } from 'react';
import { cn } from '@/lib/utils';

const PITCH = 9;
const EDGE = 28;
const FLOOR = 0.09;
// Each glow drifts on its own Lissajous path; where two meet the field brightens, so the light pools and parts.
const GLOWS = [
  { fx: 0.00038, fy: 0.0003, phase: 0, reach: 0.2 },
  { fx: 0.00024, fy: 0.00042, phase: 2.1, reach: 0.15 },
  { fx: 0.00034, fy: 0.00021, phase: 4.2, reach: 0.12 },
] as const;
// A ring spreads from wherever the light pooled, every RIPPLE_MS, flaring the dots it crosses.
const RIPPLE_MS = 2800;
const RIPPLE_WIDTH = 8;

/**
 * The frame of an image still being made: a fine dot grid that soft glows drift through, the dots swelling and
 * brightening where the light pools, a ripple spreading from it every couple of seconds, everything else twinkling. Ink is `currentColor`, so it follows the theme.
 * `onCentre` reports where the light is brightest (0–1 of the frame), so the image can land from there.
 */
export function GeneratingDots({
  className,
  onCentre,
}: {
  className?: string;
  onCentre?: (x: number, y: number) => void;
}) {
  const reduced = useReducedMotionConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const report = useEffectEvent((x: number, y: number) => onCentre?.(x, y));

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let width = 0;
    let height = 0;
    let frame = 0;
    let isVisible = true;
    let ripple = { start: -RIPPLE_MS, x: 0, y: 0 };
    let pooled = { x: 0, y: 0 };

    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = box.width;
      height = box.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = getComputedStyle(canvas).color;
      const size = Math.min(width, height);
      const glows = GLOWS.map((g) => ({
        x: width * (0.5 + 0.36 * Math.sin(now * g.fx + g.phase)),
        y: height * (0.5 + 0.34 * Math.cos(now * g.fy + g.phase * 1.3)),
        r2: 2 * (size * g.reach) ** 2,
      }));
      const columns = Math.floor(width / PITCH);
      const rows = Math.floor(height / PITCH);
      const left = (width - (columns - 1) * PITCH) / 2;
      const top = (height - (rows - 1) * PITCH) / 2;
      let best = { light: -1, x: 0.5, y: 0.5 };
      if (now - ripple.start > RIPPLE_MS) ripple = { start: now, ...pooled };
      const spread = (now - ripple.start) / RIPPLE_MS;
      const ringRadius = spread * size * 0.9;
      const ringStrength = 0.75 * (1 - spread) ** 1.5;

      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const x = left + column * PITCH;
          const y = top + row * PITCH;
          let light = 0;
          for (const g of glows)
            light += Math.exp(-((x - g.x) ** 2 + (y - g.y) ** 2) / g.r2);
          if (light > best.light) best = { light, x, y };
          const ring = Math.hypot(x - ripple.x, y - ripple.y) - ringRadius;
          light = Math.min(
            1,
            light +
              ringStrength * Math.exp(-(ring * ring) / (2 * RIPPLE_WIDTH ** 2)),
          );
          const seed = Math.sin(column * 12.9898 + row * 78.233) * 43758.5453;
          const twinkle =
            0.6 +
            0.4 * Math.sin(now * 0.003 + (seed - Math.floor(seed)) * 6.283);
          const edge = Math.min(
            1,
            Math.min(x, y, width - x, height - y) / EDGE,
          );
          // Every dot keeps a faint floor, so the grid itself never disappears; only the light fades toward the edges.
          const alpha = FLOOR + 0.85 * light * light * twinkle * edge * edge;
          const radius = 0.5 + 0.7 * light;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      pooled = { x: best.x, y: best.y };
      report(best.x / width, best.y / height);
      if (isVisible && !reduced) frame = requestAnimationFrame(draw);
    };

    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    const resizes = new ResizeObserver(() => {
      resize();
      start();
    });
    // Off-screen frames cost nothing: a long transcript can hold several.
    const visibility = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
      if (isVisible) start();
      else cancelAnimationFrame(frame);
    });
    resizes.observe(canvas);
    visibility.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      resizes.disconnect();
      visibility.disconnect();
    };
  }, [reduced]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 size-full text-foreground',
        className,
      )}
    />
  );
}
