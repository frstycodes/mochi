import NumberFlow, {
  type NumberFlowProps,
  type Plugin,
} from '@number-flow/react';
import { useReducedMotionConfig } from 'motion/react';
import { cn } from '@/lib/utils';

/** A number whose digits roll up or down, blurring as they pass, when it changes. Mounting never animates, only a change does. */
export function AnimatedNumber({
  className,
  format = PLAIN,
  plugins = [],
  ...props
}: NumberFlowProps) {
  // Motion's config folds in the app's own reduce-motion setting, not just the OS one NumberFlow reads.
  const reduce = useReducedMotionConfig();
  return (
    <NumberFlow
      animated={!reduce}
      locales="en"
      className={cn('tabular', className)}
      format={format}
      plugins={[spinBlur, ...plugins]}
      {...props}
    />
  );
}

/** Matches `{n}` in JSX: no thousands separators unless a caller asks. */
const PLAIN = { useGrouping: false } satisfies Intl.NumberFormatOptions;

/**
 * NumberFlow has no blur option; `getDelta` is its only per-digit hook, called just before a digit spins.
 * Returning nothing leaves the spin distance to NumberFlow and later plugins.
 */
const spinBlur: Plugin = {
  getDelta(value, prev, digit) {
    if (value === prev) return;
    const { spinTiming, transformTiming } = digit.flow;
    digit.el.animate(
      { filter: ['blur(0)', 'blur(0.06em)', 'blur(0)'], offset: [0, 0.4, 1] },
      spinTiming ?? transformTiming,
    );
  },
};
