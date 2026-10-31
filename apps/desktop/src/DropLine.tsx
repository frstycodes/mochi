import { motion, type MotionProps } from 'motion/react';

/** Holds a dragged row's space at its slot with the drop marker across it: a pin, a hollow circle at the start of a line. */
export function DropLine({
  height,
  glide,
}: {
  height: number;
  glide: MotionProps;
}) {
  return (
    <motion.li
      {...glide}
      aria-hidden
      className="relative list-none"
      style={{ height }}
    >
      <span className="absolute top-1/2 right-1 left-0.5 flex -translate-y-1/2 items-center">
        <span className="size-2 shrink-0 rounded-full border-2 border-info" />
        <span className="h-0.5 flex-1 rounded-r-full bg-info" />
      </span>
    </motion.li>
  );
}
