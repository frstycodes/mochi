import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Search } from '@/icons';
import { Button } from '@/components/ui/button';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Shortcut } from './Shortcut';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** The app's ⌘+ / ⌘− zoom as a capsule at the top centre: shows on each change, hides itself unless the pointer or focus is on it. */
export function ZoomChip({
  zoom,
  onReset,
  className,
}: {
  zoom: number;
  onReset: () => void;
  className?: string;
}) {
  const percent = Math.round(zoom * 100);
  const { shown, hold, hide } = useZoomFlash(percent);
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key="zoom"
          className={cn('flex justify-center', className)}
          initial={{ y: -16, opacity: 0, filter: 'blur(4px)' }}
          animate={{
            y: 0,
            opacity: 1,
            filter: 'blur(0px)',
            transition: { duration: 0.22, ease: EASE_OUT },
          }}
          exit={{
            y: -16,
            opacity: 0,
            filter: 'blur(4px)',
            transition: { duration: 0.15, ease: EASE_OUT },
          }}
        >
          <div
            role="status"
            className="flex h-10 items-center gap-2 rounded-full border bg-popover p-1 pl-3 shadow-float"
            {...hold}
          >
            <Search aria-hidden className="size-4 text-muted-foreground" />
            <AnimatedNumber
              value={percent}
              suffix="%"
              aria-label={`Zoom ${percent}%`}
              className="min-w-[4ch] text-center type-prose"
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="secondary"
                    size="sm"
                    className="rounded-full"
                    disabled={percent === 100}
                    onClick={() => {
                      hide();
                      onReset();
                    }}
                  />
                }
              >
                Reset
              </TooltipTrigger>
              <TooltipContent>
                <span className="flex items-center gap-1.5 font-medium">
                  Reset to 100% <Shortcut keys={['mod', '0']} />
                </span>
              </TooltipContent>
            </Tooltip>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const HIDE_AFTER_MS = 2000;

/** Shown on every zoom change but the first render and a reset from the chip; hidden after `HIDE_AFTER_MS` while not held. */
function useZoomFlash(percent: number) {
  const [seen, setSeen] = useState(percent);
  const [shownFor, setShownFor] = useState<number | null>(null);
  const [held, setHeld] = useState(false);
  const [resetting, setResetting] = useState(false);

  if (seen !== percent) {
    setSeen(percent);
    setShownFor(resetting ? null : percent);
    setHeld(false);
    setResetting(false);
  }

  useEffect(() => {
    if (shownFor === null || held) return;
    const timer = setTimeout(() => setShownFor(null), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [shownFor, held]);

  const hold = {
    onPointerEnter: () => setHeld(true),
    onPointerLeave: () => setHeld(false),
    onFocus: () => setHeld(true),
    onBlur: () => setHeld(false),
  };
  const hide = () => {
    setResetting(true);
    setShownFor(null);
  };
  return { shown: shownFor !== null, hold, hide };
}
