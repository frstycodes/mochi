import { useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const SWEEP_MS = 1100;
const REST_MS = 1200;
const SHIMMER_MASK =
  'linear-gradient(90deg, rgb(0 0 0 / 0.45) 42%, #000 50%, rgb(0 0 0 / 0.45) 58%)';

/** Crossfades a reply and its simplified version when `view` changes; the reply shimmers while it is being simplified. */
export function SimplifySwap({
  view,
  isSimplifying,
  children,
}: {
  view: 'original' | 'simplified';
  isSimplifying: boolean;
  children: ReactNode;
}) {
  const reduce = useReducedMotionConfig();
  const blur = (px: number) => (reduce ? {} : { filter: `blur(${px}px)` });
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={view}
        initial={{ opacity: 0, ...blur(4) }}
        animate={{
          opacity: 1,
          ...blur(0),
          transition: { duration: 0.25, ease: EASE_OUT },
        }}
        exit={{
          opacity: 0,
          ...blur(4),
          transition: { duration: 0.15, ease: EASE_OUT },
        }}
      >
        <SimplifyShimmer isActive={isSimplifying}>{children}</SimplifyShimmer>
      </motion.div>
    </AnimatePresence>
  );
}

/** The text shimmer for a whole block: a mask dims everything to muted while a full-strength band sweeps across, so code blocks and chips shimmer with the prose. */
function SimplifyShimmer({
  isActive,
  children,
}: {
  isActive: boolean;
  children: ReactNode;
}) {
  const reduce = useReducedMotionConfig();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !isActive || reduce) return;
    const animation = el.animate(
      [
        { maskPosition: '100% 0', easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
        { maskPosition: '0% 0', offset: SWEEP_MS / (SWEEP_MS + REST_MS) },
        { maskPosition: '0% 0' },
      ],
      { duration: SWEEP_MS + REST_MS, iterations: Infinity },
    );
    return () => animation.cancel();
  }, [isActive, reduce]);

  const style =
    isActive &&
    (reduce
      ? { opacity: 0.55 }
      : {
          maskImage: SHIMMER_MASK,
          maskSize: '250% 100%',
          maskPosition: '100% 0',
        });
  return (
    <div
      ref={ref}
      aria-busy={isActive}
      style={style || undefined}
      className="flex flex-col gap-2"
    >
      {children}
    </div>
  );
}
