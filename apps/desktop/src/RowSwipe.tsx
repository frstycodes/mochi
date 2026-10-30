import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { Archive, Snooze } from '@/icons';
import { cn } from '@/lib/utils';
import { ROW_ACTION_TONE } from './rowActionTone';

/**
 * Experiment (`#thread-rows`): drag a row sideways like a Sonner toast, right to snooze and left to settle.
 * The row follows the pointer 1:1; letting go acts only past `COMMIT_PX` or on a quick flick, otherwise it slides back.
 * Nothing here clips: the row keeps its rounded tab while it slides and is cut only where the sidebar's scroller ends.
 * GAP: in the real sidebar a press-and-drag reorders rows and a rightward drag nests one, so this can't ship there as is.
 */
export function RowSwipe({
  onSnooze,
  onSettle,
  children,
}: {
  onSnooze: () => void;
  onSettle: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const handlers = useDragSwipe(ref, x, { onSnooze, onSettle });
  // Off its rest spot the row shows its tab, so its rounded edge faces the colour across the gap.
  const [isMoved, setMoved] = useState(false);
  useMotionValueEvent(x, 'change', (v) => setMoved(v !== 0));
  return (
    <div ref={ref} {...handlers} className="relative touch-pan-y select-none">
      <SwipeBackdrop x={x} />
      <motion.div
        style={{ x }}
        className={cn(
          'relative rounded-md bg-sidebar',
          // Mid-swipe the colour says what letting go does; the hover buttons would only crowd it.
          isMoved && 'bg-sidebar-accent [&_[data-sidebar=menu-action]]:hidden',
        )}
      >
        {children}
      </motion.div>
    </div>
  );
}

/** Pointer travel before a drag claims the gesture, so a click never nudges the row. */
const SLOP_PX = 8;
/** Past this, letting go acts. */
const COMMIT_PX = 96;
/** A flick (px/ms) acts from a shorter drag. */
const FLICK_SPEED = 0.6;
const FLICK_MIN_PX = 32;
/** The space between the row and the colour it uncovers. */
const GAP_PX = 6;
const BACK_SPRING = { type: 'spring', bounce: 0, visualDuration: 0.3 } as const;
const OUT_SPRING = { type: 'spring', bounce: 0, visualDuration: 0.2 } as const;

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  isClaimed: boolean;
}

function useDragSwipe(
  ref: React.RefObject<HTMLDivElement | null>,
  x: MotionValue<number>,
  { onSnooze, onSettle }: { onSnooze: () => void; onSettle: () => void },
) {
  const drag = useRef<Drag | null>(null);
  // A drag ends in a click on the row underneath; it must not open the thread.
  const isClickSwallowed = useRef(false);
  const end = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.isClaimed) return;
    isClickSwallowed.current = true;
    const offset = x.get();
    const speed = Math.abs(offset) / Math.max(1, e.timeStamp - d.startedAt);
    if (!isCommit(offset, speed)) {
      animate(x, 0, BACK_SPRING);
      return;
    }
    const direction = Math.sign(offset);
    const width = ref.current?.offsetWidth ?? 0;
    // Acts as it lets go: the row keeps sliding out while its exit fades and folds it, rather than waiting for the slide to settle. No reset, the row is leaving this list.
    animate(x, direction * width, OUT_SPRING);
    if (direction > 0) onSnooze();
    else onSettle();
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      x.stop();
      drag.current = {
        pointerId: e.pointerId,
        startX: e.clientX - x.get(),
        startY: e.clientY,
        startedAt: e.timeStamp,
        isClaimed: false,
      };
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      const dx = e.clientX - d.startX;
      if (!d.isClaimed) {
        const dy = e.clientY - d.startY;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP_PX) return;
        // Mostly vertical: a scroll, not a swipe.
        if (Math.abs(dy) > Math.abs(dx)) {
          drag.current = null;
          return;
        }
        d.isClaimed = true;
        // Measure the flick from here, and start the row from the pointer without the slop's jump.
        d.startX += Math.sign(dx) * SLOP_PX;
        d.startedAt = e.timeStamp;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      x.set(e.clientX - d.startX);
    },
    onPointerUp: end,
    onPointerCancel: end,
    // Capture can go without an up (released outside the window, focus stolen); the row must never be left mid-swipe.
    onLostPointerCapture: end,
    onClickCapture: (e: React.MouseEvent) => {
      if (!isClickSwallowed.current) return;
      isClickSwallowed.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}

/** Whether letting go at `offset` px, moving at `speed` px/ms on average, snoozes or settles. */
export function isCommit(offset: number, speed: number) {
  const distance = Math.abs(offset);
  return (
    distance >= COMMIT_PX || (distance >= FLICK_MIN_PX && speed >= FLICK_SPEED)
  );
}

/** The colour the row uncovers, a rounded pill of its own a few pixels from it: Snooze on the left as it slides right, Settle on the right as it slides left. */
function SwipeBackdrop({ x }: { x: MotionValue<number> }) {
  const [side, setSide] = useState<'snooze' | 'settle' | null>(null);
  // The icon pops in as soon as there's room for it; the label follows once letting go would act.
  const [hasIcon, setIcon] = useState(false);
  const [isArmed, setArmed] = useState(false);
  useMotionValueEvent(x, 'change', (v) => {
    setSide(v > 0 ? 'snooze' : v < 0 ? 'settle' : null);
    setIcon(Math.abs(v) >= ICON_PX);
    setArmed(Math.abs(v) >= COMMIT_PX);
  });
  const width = useTransform(x, (v) => Math.max(0, Math.abs(v) - GAP_PX));
  // Narrower than its corner radius the pill is only a sliver: it fades in once it reads as a shape.
  const opacity = useTransform(x, (v) =>
    Math.min(1, Math.max(0, (Math.abs(v) - GAP_PX - 8) / 16)),
  );
  if (!side) return null;
  const isSnooze = side === 'snooze';
  const icon = (
    <motion.span
      initial={false}
      animate={
        hasIcon ? SHOWN : { opacity: 0, scale: 0.5, filter: 'blur(2px)' }
      }
      transition={POP}
      className="flex shrink-0"
    >
      {isSnooze ? (
        <Snooze aria-hidden className="size-4" />
      ) : (
        <Archive aria-hidden className="size-4" />
      )}
    </motion.span>
  );
  const label = (
    <motion.span
      initial={false}
      animate={
        isArmed
          ? SHOWN
          : {
              opacity: 0,
              scale: 0.9,
              x: isSnooze ? -4 : 4,
              filter: 'blur(2px)',
            }
      }
      transition={POP}
      className="shrink-0 type-meta font-medium whitespace-nowrap"
    >
      {isSnooze ? 'Snooze' : 'Settle'}
    </motion.span>
  );
  // The icon sits on the edge the pill grows from, the label on its inside, so neither moves when the other appears.
  return (
    <motion.div
      aria-hidden
      style={{ width, opacity }}
      className={cn(
        'absolute inset-y-0 flex items-center gap-1.5 overflow-hidden rounded-md px-3',
        isSnooze
          ? cn('left-0 justify-start', ROW_ACTION_TONE.snooze)
          : cn('right-0 justify-end', ROW_ACTION_TONE.settle),
      )}
    >
      {isSnooze ? (
        <>
          {icon}
          {label}
        </>
      ) : (
        <>
          {label}
          {icon}
        </>
      )}
    </motion.div>
  );
}

/** The uncovered pill is wide enough for the icon. */
const ICON_PX = 36;
const SHOWN = { opacity: 1, scale: 1, x: 0, filter: 'blur(0px)' };
const POP = { type: 'spring', bounce: 0.35, visualDuration: 0.2 } as const;
