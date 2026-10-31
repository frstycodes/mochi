import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { motion, useReducedMotionConfig } from 'motion/react';
import { cn } from '@/lib/utils';

export const AUTO_HEIGHT_SPRING = { type: 'spring', visualDuration: 0.15, bounce: 0 } as const;

/** Animates its height to fit its children, retargeting mid-flight so per-keystroke changes stay smooth. */
export function AutoHeight({ className, children }: Pick<ComponentProps<'div'>, 'className' | 'children'>) {
  const reduce = useReducedMotionConfig();
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setHeight(e.borderBoxSize[0].blockSize));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={reduce ? { duration: 0 } : AUTO_HEIGHT_SPRING}
      className={cn('flex flex-col overflow-hidden', className)}
    >
      {/* flex-col lets callers pick which edge stays put while clipped: `justify-end` keeps the bottom visible on bottom-anchored boxes */}
      <div ref={inner} className="shrink-0">
        {children}
      </div>
    </motion.div>
  );
}
