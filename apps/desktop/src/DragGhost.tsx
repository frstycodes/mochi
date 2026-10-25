import { useLayoutEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, useMotionValue, useReducedMotionConfig } from 'motion/react';
import { cn } from '@/lib/utils';
import { tiltFor } from './dragTilt';

/**
 * What follows the pointer while something is dragged. It hangs from where it was grabbed: held left of centre its right end
 * dips, held right its left end dips, held in the middle it stays level. Give the dropped item the same `layoutId` and it
 * glides from here into its slot while it levels out.
 */
export function DragGhost({
  x,
  y,
  width,
  grabX,
  grabY,
  layoutId,
  className,
  children,
}: {
  x: number;
  y: number;
  width: number;
  grabX: number;
  grabY: number;
  layoutId?: string;
  className?: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotionConfig();
  // Motion values, not style props: a re-render with a new left/top would read as a layout change and animate behind the pointer.
  const left = useMotionValue(x);
  const top = useMotionValue(y);
  useLayoutEffect(() => {
    left.set(x);
    top.set(y);
  }, [left, top, x, y]);
  return createPortal(
    <motion.div
      aria-hidden
      layoutId={layoutId}
      className={cn(
        'pointer-events-none fixed z-[600] shadow-float',
        className,
      )}
      style={{ left, top, width, originX: `${grabX}px`, originY: `${grabY}px` }}
      initial={{ rotate: 0 }}
      animate={{ rotate: reduce ? 0 : tiltFor(grabX, width) }}
      transition={TILT}
    >
      {children}
    </motion.div>,
    document.body,
  );
}

const TILT = { type: 'spring', visualDuration: 0.3, bounce: 0.2 } as const;
