import { motion, type MotionProps } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * Holds a dragged row's space at its slot with the drop marker across it: a pin, a hollow circle at the start of a line. Nesting,
 * the pin starts at the sub-thread indent.
 */
export function DropLine({
  height,
  isNested,
  glide,
}: {
  height: number;
  isNested: boolean;
  glide: MotionProps;
}) {
  return (
    <motion.li
      {...glide}
      aria-hidden
      className="relative list-none"
      style={{ height }}
    >
      <span
        className={cn(
          'absolute top-1/2 right-1 flex -translate-y-1/2 items-center',
          isNested ? 'left-[23px]' : 'left-0.5',
        )}
      >
        <span className="size-2 shrink-0 rounded-full border-2 border-info" />
        <span className="h-0.5 flex-1 rounded-r-full bg-info" />
      </span>
    </motion.li>
  );
}
