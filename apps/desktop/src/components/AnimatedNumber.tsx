import NumberFlow, { type NumberFlowProps } from '@number-flow/react';
import { useReducedMotionConfig } from 'motion/react';
import { cn } from '@/lib/utils';

/** A number whose digits roll up or down when it changes. Mounting never animates, only a change does. */
export function AnimatedNumber({
  className,
  format = PLAIN,
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
      {...props}
    />
  );
}

/** Matches `{n}` in JSX: no thousands separators unless a caller asks. */
const PLAIN = { useGrouping: false } satisfies Intl.NumberFormatOptions;
