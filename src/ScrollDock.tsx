import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotionConfig, useScroll, useTransform, type MotionValue } from 'motion/react';

export interface DockItem<T> {
  value: T;
  label: string;
  icon: ReactNode;
}

const SPACING = 46;
const TILE = 40;
const DOCK_WIDTH = SPACING * 5.5;
const CLOSE_AFTER_MS = 600;
const LEAVE_RADIUS_PX = 120;
const GESTURE_GAP_MS = 140;
const STEP_PX = 32;
// The fade is kept short so the scale, not the opacity, carries the motion; with one shared ease-out the scale was done before the dock was visible.
const DOCK_IN = { opacity: { duration: 0.12, ease: 'linear' }, default: { type: 'spring', visualDuration: 0.3, bounce: 0.12 } } as const;
const DOCK_OUT = { opacity: { duration: 0.18, ease: [0.4, 0, 0.2, 1] }, default: { duration: 0.18, ease: [0.77, 0, 0.175, 1] } } as const;

// GAP: browsers expose no trackpad haptics. The desktop shell maps this to NSHapticFeedbackManager's alignment pattern; phones get a short vibration.
function haptic() {
  navigator.vibrate?.(6);
}

/**
 * Hover the trigger and scroll either way: a glass dock of icons rises from it. The icon row is a native scroller, so swipes and
 * momentum are the browser's own; Motion only reads the offset to magnify. The dock previews the item under the centre and the
 * trigger takes it when the dock closes, 600ms after scrolling stops or when the pointer leaves.
 */
export function ScrollDock<T extends string>({ label, value, onChange, items, children }: { label: string; value: T; onChange: (v: T) => void; items: DockItem<T>[]; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  const reduce = useReducedMotionConfig();
  const [anchor, setAnchor] = useState<{ x: number; bottom: number } | null>(null);
  const index = Math.max(0, items.findIndex((i) => i.value === value));
  const [preview, setPreview] = useState(index);
  const previewRef = useRef(index);
  const live = useRef({ index, items, onChange });
  live.current = { index, items, onChange };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let closeTimer = 0;
    let isShown = false;
    let axis: 'x' | 'y' = 'y';
    let lastT = -Infinity;
    const close = () => {
      window.clearTimeout(closeTimer);
      isShown = false;
      setAnchor(null);
      const { index: current, items: list, onChange: commit } = live.current;
      if (previewRef.current !== current) commit(list[previewRef.current].value);
    };

    // Over the dock a horizontal swipe is left to the browser (native scroll + momentum). Everything else is forwarded as an
    // instant scroll: wheel over the trigger, and vertical wheel over the dock, which a horizontal scroller would ignore.
    const onWheel = (e: WheelEvent) => {
      const strip = stripRef.current;
      const isOnTrigger = el.contains(e.target as Node);
      const isOnStrip = !!strip?.contains(e.target as Node);
      if (!isOnTrigger && !isOnStrip) return;
      if (e.timeStamp - lastT > GESTURE_GAP_MS) axis = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 'x' : 'y';
      lastT = e.timeStamp;
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(close, CLOSE_AFTER_MS);
      if (isOnStrip && axis === 'x') return;
      e.preventDefault();
      if (live.current.items.length < 2) return;
      if (!isShown) {
        isShown = true;
        previewRef.current = live.current.index;
        setPreview(live.current.index);
        const r = el.getBoundingClientRect();
        return setAnchor({ x: r.left + r.width / 2, bottom: window.innerHeight - r.top + 6 });
      }
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      strip?.scrollBy({ left: (axis === 'x' ? e.deltaX : e.deltaY) * scale, behavior: 'instant' });
    };
    const onMove = (e: PointerEvent) => {
      if (!isShown) return;
      const r = el.getBoundingClientRect();
      const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
      const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
      if (Math.hypot(dx, dy) > LEAVE_RADIUS_PX) close();
    };
    wheelRef.current = onWheel;
    // On the trigger, never on window: a non-passive wheel listener on window makes every wheel gesture in the app wait for the main
    // thread before the compositor may scroll, so swipes elsewhere (Stage, spaces) hitch whenever React is busy.
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointermove', onMove);
    return () => {
      window.clearTimeout(closeTimer);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  const isOpen = !!anchor;
  useEffect(() => {
    const dock = dockRef.current;
    if (!isOpen || !dock) return;
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    dock.addEventListener('wheel', onWheel, { passive: false });
    return () => dock.removeEventListener('wheel', onWheel);
  }, [isOpen]);

  const browse = (i: number) => {
    if (i === previewRef.current) return;
    previewRef.current = i;
    setPreview(i);
    haptic();
  };

  return (
    <span ref={ref} className="relative inline-flex">
      {children}
      {createPortal(
        <AnimatePresence>
          {anchor && (
            <motion.div
              key="dock"
              ref={dockRef}
              role="status"
              aria-label={`${label}: ${items[preview]?.label}`}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.8, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0, transition: DOCK_OUT } : { opacity: 0, scale: 0.85, y: 6, transition: DOCK_OUT }}
              transition={DOCK_IN}
              style={{ left: anchor.x - DOCK_WIDTH / 2, bottom: anchor.bottom, width: DOCK_WIDTH }}
              className="surface-glass fixed z-50 flex origin-bottom flex-col items-center rounded-2xl pb-2 shadow-float"
            >
              <DockStrip ref={stripRef} items={items} startIndex={index} onBrowse={browse} />
              <span className="type-caption whitespace-nowrap text-foreground">{items[preview]?.label}</span>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  );
}

function DockStrip<T>({ ref, items, startIndex, onBrowse }: { ref: RefObject<HTMLDivElement | null>; items: DockItem<T>[]; startIndex: number; onBrowse: (i: number) => void }) {
  const { scrollX } = useScroll({ container: ref });
  const pos = useTransform(scrollX, (x) => x / SPACING);

  // Mount only: after opening, the scroll offset is the source of truth.
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollLeft = startIndex * SPACING;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useMotionValueEvent(pos, 'change', (p) => onBrowse(Math.min(items.length - 1, Math.max(0, Math.round(p)))));

  return (
    <div
      ref={ref}
      // Inline: the global unlayered `* { scrollbar-width: thin }` in index.css beats any Tailwind utility.
      style={{ paddingInline: (DOCK_WIDTH - TILE) / 2, gap: SPACING - TILE, scrollbarWidth: 'none' }}
      className="flex h-14 w-full shrink-0 items-center overflow-x-auto overflow-y-hidden overscroll-x-contain"
    >
      {items.map((item, i) => (
        <DockTile key={String(item.value)} pos={pos} i={i}>
          {item.icon}
        </DockTile>
      ))}
    </div>
  );
}

function DockTile({ pos, i, children }: { pos: MotionValue<number>; i: number; children: ReactNode }) {
  const transform = useTransform(pos, (p) => `scale(${0.7 + 0.9 * Math.exp(-((i - p) ** 2) / 1.1)})`);
  const opacity = useTransform(pos, (p) => Math.max(0.35, 1 - Math.abs(i - p) * 0.3));
  return (
    <motion.span style={{ transform, opacity, width: TILE, height: TILE }} className="flex shrink-0 items-center justify-center text-foreground">
      {children}
    </motion.span>
  );
}

/**
 * Hover the trigger and scroll to step through `values` in place, for controls whose trigger already shows where you are (the effort
 * meter). 32px per step, at most one step per wheel event, so a notched mouse wheel moves one level per click.
 */
export function WheelStepper<T extends string>({ values, value, onChange, children }: { values: readonly T[]; value: T; onChange: (v: T) => void; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const live = useRef({ values, value, onChange });
  live.current = { values, value, onChange };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let axis: 'x' | 'y' = 'y';
    let lastT = -Infinity;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.timeStamp - lastT > GESTURE_GAP_MS) {
        axis = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 'x' : 'y';
        acc = 0;
      }
      lastT = e.timeStamp;
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      // Horizontal is inverted vs the model dock (swiping right raises effort); vertical is not (scrolling down raises it).
      acc += (axis === 'x' ? -e.deltaX : e.deltaY) * scale;
      const { values: list, value: current, onChange: change } = live.current;
      const from = list.indexOf(current);
      // Pinned at an end: don't bank distance past it, so reversing responds on the first step back.
      if ((from === 0 && acc < 0) || (from === list.length - 1 && acc > 0)) acc = 0;
      if (Math.abs(acc) < STEP_PX) return;
      const step = Math.sign(acc);
      acc = Math.abs(acc) >= 2 * STEP_PX ? 0 : acc - step * STEP_PX;
      const next = list[Math.min(list.length - 1, Math.max(0, from + step))];
      live.current.value = next;
      change(next);
      haptic();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <span ref={ref} className="relative inline-flex">
      {children}
    </span>
  );
}
