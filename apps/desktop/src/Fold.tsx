import {
  createContext,
  useContext,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronRight } from '@/icons';
import { cn } from '@/lib/utils';
import { EASE_OUT } from './lib/ease';

/**
 * Every disclosure in the app: Base UI Collapsible for state and aria, and one height-and-fade motion that a second click
 * mid-fold reverses from where it is. Style the trigger for its surface; the chevron and the motion are the same everywhere.
 */
export function Fold({
  open,
  defaultOpen = false,
  onOpenChange,
  ...props
}: ComponentProps<typeof Collapsible>) {
  const [isOpenState, setOpenState] = useState(defaultOpen);
  const isOpen = open ?? isOpenState;
  return (
    <FoldContext value={isOpen}>
      <Collapsible
        open={isOpen}
        onOpenChange={(next, eventDetails) => {
          setOpenState(next);
          onOpenChange?.(next, eventDetails);
        }}
        {...props}
      />
    </FoldContext>
  );
}

/** The fold's button; `leading` puts the chevron before the label, as trees do. */
export function FoldTrigger({
  isLeading,
  className,
  children,
  ...props
}: ComponentProps<typeof CollapsibleTrigger> & { isLeading?: boolean }) {
  return (
    <CollapsibleTrigger className={cn('group/fold', className)} {...props}>
      {isLeading && <FoldChevron />}
      {children}
      {!isLeading && <FoldChevron />}
    </CollapsibleTrigger>
  );
}

/**
 * Points at its label while closed and turns down to the content when open, everywhere. Sized in em so it keeps one ratio
 * to the text beside it (through Solar's `--solar-size`, which sets the glyph's own font size). Inside a FoldTrigger it follows the fold; elsewhere pass `isOpen`.
 */
export function FoldChevron({
  isOpen,
  className,
  ...props
}: ComponentProps<typeof ChevronRight> & { isOpen?: boolean }) {
  return (
    <ChevronRight
      aria-hidden
      {...props}
      className={cn(
        'size-[1em]! shrink-0 [--solar-size:0.85em] transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
        isOpen === undefined
          ? 'group-data-panel-open/fold:rotate-90'
          : isOpen && 'rotate-90',
        className,
      )}
    />
  );
}

/** Stays mounted while closed (inert, zero height), so opening never remounts its rows. */
export function FoldContent({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const isOpen = useFoldOpen();
  return (
    <CollapsibleContent
      keepMounted
      render={
        <FoldBox
          initial={false}
          animate={isOpen ? 'open' : 'closed'}
          inert={!isOpen || undefined}
          // Base UI sees no CSS transition on the panel, so it sets `hidden` the moment the fold closes and cuts the motion.
          hidden={false}
          className={className}
        />
      }
    >
      {children}
    </CollapsibleContent>
  );
}

/** A fold driven by a boolean that unmounts its content while closed, for content too heavy to keep around. */
export function Expand({
  isOpen,
  children,
}: {
  isOpen: boolean;
  children: ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <FoldBox initial="closed" animate="open" exit="closed">
          {children}
        </FoldBox>
      )}
    </AnimatePresence>
  );
}

/** The fold's motion, Settled's from the start: height and a fade together on one ease-out, retargeting mid-flight. */
function FoldBox({ className, ...props }: ComponentProps<typeof motion.div>) {
  const reduce = useReducedMotionConfig();
  return (
    <motion.div
      variants={{
        open: { height: 'auto', opacity: 1 },
        closed: { height: 0, opacity: 0 },
      }}
      transition={reduce ? { duration: 0 } : FOLD_EASE}
      // y clips the height; x stays visible for focus rings and badge overhangs.
      className={cn('overflow-x-visible overflow-y-clip', className)}
      {...props}
    />
  );
}

const FOLD_EASE = { duration: 0.2, ease: EASE_OUT } as const;

const FoldContext = createContext<boolean | null>(null);

function useFoldOpen() {
  const isOpen = useContext(FoldContext);
  if (isOpen === null) throw new Error('FoldContent must sit inside a Fold');
  return isOpen;
}
