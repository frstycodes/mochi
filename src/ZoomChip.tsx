import { AnimatePresence, motion } from 'motion/react';
import { SearchZoomIn, SearchZoomOut } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Shortcut } from './Shortcut';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** The app's ⌘+ / ⌘− zoom as a capsule at the top centre; stays while off 100%, click resets. */
export function ZoomChip({ zoom, onReset, className }: { zoom: number; onReset: () => void; className?: string }) {
  const percent = Math.round(zoom * 100);
  return (
    <AnimatePresence>
      {percent !== 100 && (
        <motion.div
          key="zoom"
          className={cn('flex justify-center', className)}
          initial={{ y: -16, opacity: 0, filter: 'blur(4px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)', transition: { duration: 0.22, ease: EASE_OUT } }}
          exit={{ y: -16, opacity: 0, filter: 'blur(4px)', transition: { duration: 0.15, ease: EASE_OUT } }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" onClick={onReset} className="bg-popover px-2.5 tabular-nums shadow-float dark:bg-popover dark:hover:bg-muted" aria-label={`Zoom ${percent}%, reset to 100%`}>
                {percent > 100 ? <SearchZoomIn aria-hidden /> : <SearchZoomOut aria-hidden />}
                {percent}%
              </Button>
            </TooltipTrigger>
            <TooltipContent className="flex-col items-start gap-0.5">
              <span className="flex items-center gap-1.5 font-medium">
                Reset to 100% <Shortcut keys={['mod', '0']} />
              </span>
            </TooltipContent>
          </Tooltip>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
