import { listenKeydown, isCommand } from '../keymap';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { ChevronDownSmall, ChevronUpSmall } from '@/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ToastIdContext } from './context';
import { GAP, itemHeight, itemTransform, motionTiming, MORPH_MS, openSlots, slowmo, STACK_MS, stackSlots, VISIBLE, type Slot } from './stack';
import { dismiss, getToasts, subscribe, type Toast } from './store';
import { ToastRow, ToastSummary } from './ToastContent';

/** How far an opened toast grows past the stack on each side, never past a 16px gutter. */
const GROWTH = 'clamp(0px, (100vw - 388px) / 2, 32px)';
const OPEN_INSET = `calc(-1 * ${GROWTH})`;

/** Widths of the card's two faces; `cqw` is the stack's own width. */
const SUMMARY_WIDTH = '100cqw';
const WIDGET_WIDTH = `calc(100cqw + 2 * ${GROWTH})`;

/**
 * Top-center stack that behaves like Sonner: collapsed it shows the newest with two peeking behind at its height; hover or focus
 * fans it out and pauses every countdown, and it stays fanned out while a press that started in it is held. A toast with an
 * `expand` widget opens in place into it, like the Dynamic Island, and the rest of the stack steps aside.
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getToasts);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [isHovered, setHovered] = useState(false);
  const [isInteracting, setInteracting] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const isWindowActive = useIsWindowActive();
  const listRef = useRef<HTMLOListElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useFocusHotkey(listRef, toasts.length > 0);

  const isEmpty = toasts.length === 0;
  if (isEmpty && isHovered) setHovered(false);

  // Right after a collapse the pointer is still over the stack and focus is back on the toast, which would fan the stack out
  // mid-morph. It stays folded until the pointer moves or a key is pressed in it.
  const [isHeldFolded, setHeldFolded] = useState(false);
  const collapse = () => {
    setOpenId(null);
    setHeldFolded(true);
  };

  const live = toasts.filter((t) => !t.isLeaving);
  const open = live.find((t) => t.id === openId && !!t.expand);
  useCloseOnOutsidePointer(listRef, !!open, collapse);
  if (openId && !open) setOpenId(null);

  const isExpanded = !open && !isHeldFolded && (isHovered || isInteracting || hasFocus);
  const slots = open ? openSlots(toasts, open.id) : stackSlots(toasts, heights);
  // As in Sonner, the front height is the newest one registered: a toast registers once it has mounted, so for its first frame the
  // ones behind keep the old front's height, then animate to the new one instead of snapping to it.
  const front = open ?? live.find((t) => t.id in heights);
  const frontHeight = (front && heights[front.id]) ?? 0;
  const height = open ? frontHeight : isExpanded ? slots.total : frontHeight + Math.min(live.length - 1, VISIBLE - 1) * GAP;

  const closeFromKeyboard = (id: string) => {
    dismiss(id);
    const next = live.find((t) => t.id !== id);
    const nextButton = next && listRef.current?.querySelector<HTMLElement>(`[data-toast-id="${CSS.escape(next.id)}"] [data-toast-close]`);
    (nextButton ?? returnFocus.current)?.focus();
  };

  return (
    <section aria-label="Notifications" className="pointer-events-none fixed inset-x-0 top-13 z-[500] flex justify-center px-4 app-no-drag">
      <ol
        ref={listRef}
        aria-live="polite"
        className={cn('@container relative w-full max-w-[356px]', !isEmpty && 'pointer-events-auto')}
        style={{ height: Math.max(height, 0) }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerMove={() => {
          setHovered(true);
          if (isHeldFolded) setHeldFolded(false);
        }}
        onPointerDown={() => setInteracting(true)}
        onPointerUp={() => setInteracting(false)}
        onPointerCancel={() => setInteracting(false)}
        // Capture: Escape's own collapse runs after this in the toast and holds the stack again.
        onKeyDownCapture={() => isHeldFolded && setHeldFolded(false)}
        onFocus={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) returnFocus.current = e.relatedTarget as HTMLElement | null;
          setHasFocus(true);
        }}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHasFocus(false)}
      >
        {toasts.map((t) => (
          <ToastItem
            key={t.id}
            toast={t}
            slot={slots.byId[t.id]}
            frontHeight={frontHeight}
            height={heights[t.id] ?? 0}
            isExpanded={isExpanded}
            isOpen={t === open}
            isPaused={isExpanded || !!open || !isWindowActive}
            onHeight={(h) => setHeights((all) => withHeight(all, t.id, h))}
            onOpen={() => setOpenId(t.id)}
            onCollapse={collapse}
            onKeyboardClose={() => closeFromKeyboard(t.id)}
          />
        ))}
      </ol>
    </section>
  );
}

type ToastItemProps = {
  toast: Toast;
  slot: Slot;
  frontHeight: number;
  height: number;
  isExpanded: boolean;
  isOpen: boolean;
  isPaused: boolean;
  /** The toast's measured height once it has mounted, and `null` when it unmounts. */
  onHeight: (height: number | null) => void;
  onOpen: () => void;
  onCollapse: () => void;
  onKeyboardClose: () => void;
};

function ToastItem({ toast, slot, frontHeight, height, isExpanded, isOpen, isPaused, onHeight, onOpen, onCollapse, onKeyboardClose }: ToastItemProps) {
  const liRef = useRef<HTMLLIElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const [isMounted, setMounted] = useState(false);
  useMeasure(contentRef, onHeight, isMounted);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  // A decision in the widget swaps the toast for its outcome and drops `expand`; the last widget stays mounted to fade out while
  // the card shrinks into the outcome, instead of vanishing on the first frame.
  const [widget, setWidget] = useState(toast.expand);
  if (toast.expand && toast.expand !== widget) setWidget(toast.expand);

  // Collapsing keeps the morph timing until the card is back to its toast size. A timer, not `transitionend`: on a narrow window
  // neither the width nor the corners change, so no transition would end.
  const [isClosing, setClosing] = useState(false);
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    setClosing(!isOpen);
  }
  useEffect(() => {
    if (!isClosing) return;
    const slowdown = Number(getComputedStyle(document.documentElement).getPropertyValue('--toast-slowmo')) || 1;
    const timer = window.setTimeout(() => setClosing(false), MORPH_MS * slowdown);
    return () => window.clearTimeout(timer);
  }, [isClosing]);
  const isMorphing = isOpen || isClosing;

  const refocusOpener = useRef(false);
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    const li = liRef.current;
    const isFocusLost = !document.activeElement || document.activeElement === document.body || !!li?.contains(document.activeElement);
    if (isOpen) widgetRef.current?.focus({ preventScroll: true });
    // After the render, not in the handler: until then the opener sits in an inert region and can't take focus.
    else if (refocusOpener.current) openerRef.current?.focus({ preventScroll: true });
    // Turned into an outcome from inside the widget: focus the outcome's first control (its Undo) rather than the page.
    else if (wasOpen.current && isFocusLost) li?.querySelector<HTMLElement>('button:not([inert] *)')?.focus({ preventScroll: true });
    refocusOpener.current = false;
    wasOpen.current = isOpen;
  }, [isOpen]);

  const isFront = slot.index === 0;
  const isHidden = slot.index >= VISIBLE;
  const isCollapsedBehind = !isExpanded && !isFront;
  const isTimed = Number.isFinite(toast.duration);
  const transform = itemTransform({ slot, isExpanded, isMounted, isLeaving: toast.isLeaving });

  const collapse = () => {
    refocusOpener.current = true;
    onCollapse();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (isOpen) collapse();
    else onKeyboardClose();
  };
  const runAction = (e: MouseEvent) => {
    toast.action?.onClick();
    if (e.detail === 0) onKeyboardClose();
    else dismiss(toast.id);
  };

  const motionClass = cn(
    // No transform-origin: Sonner scales the toasts behind about their centre, which sets both the peek and the path they take.
    'absolute inset-x-0 top-0 rounded-xl transition-[transform,opacity,filter,left,right,height,border-radius] motion-reduce:transition-none',
    (!isMounted || toast.isLeaving || isHidden) && 'opacity-0',
    // Ours on top of Sonner's slide and fade: toasts blur in and out.
    (!isMounted || toast.isLeaving) && 'blur-[6px]',
    isHidden && 'pointer-events-none',
  );
  const sizeState = { isFront, isExpanded, isMounted, isMorphing, canOpen: !!widget, height, frontHeight };
  const size = { height: itemHeight(sizeState) || undefined, ...(isOpen && { left: OPEN_INSET, right: OPEN_INSET }) };
  const motionStyle = { transform, ...size, ...motionTiming({ isLeaving: toast.isLeaving, isFront, isExpanded, isMorphing }) };

  const summary = <ToastSummary toast={toast} />;

  return (
    <>
      {/* The drop shadow lives in a layer under every card, so an expanded stack never shades its neighbours. */}
      <li aria-hidden className={cn(motionClass, 'pointer-events-none shadow-[var(--elev-lift)]', isOpen && 'rounded-2xl')} style={motionStyle} />
      <li
        ref={liRef}
        data-toast-id={toast.id}
        role={toast.type === 'error' ? 'alert' : undefined}
        aria-hidden={isHidden || undefined}
        inert={isHidden || toast.isLeaving}
        onKeyDown={onKeyDown}
        className={cn(
          motionClass,
          'bg-popover text-popover-foreground shadow-[0_0_0_1px_var(--border)] select-none',
          // Clipped only while it morphs, and with `overflow-clip`, not `hidden`: a hidden box is still scrollable, so a widget
          // focusing a field below the card's animating height scrolled the content up, then back down as the card grew. Otherwise
          // unclipped, as in Sonner: a toast shrinking behind the front one lets its content fade out past the edge.
          isMorphing && 'overflow-clip',
          isOpen && 'rounded-2xl',
        )}
        style={{ ...motionStyle, zIndex: 1 + VISIBLE - slot.index }}
      >
        <div ref={contentRef} style={{ transitionDuration: slowmo(STACK_MS) }} className={cn('relative transition-opacity ease-[ease]', isCollapsedBehind && 'opacity-0')}>
          <Face isActive={!isOpen} width={SUMMARY_WIDTH} timing={SUMMARY_FADE}>
            <ToastRow toast={toast} onAction={runAction} onClose={(e) => (e.detail === 0 ? onKeyboardClose() : dismiss(toast.id))}>
              {toast.expand ? (
                <button
                  ref={openerRef}
                  type="button"
                  aria-expanded={isOpen}
                  className="-my-1 -ml-1.5 flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 rounded-lg py-1 pl-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={onOpen}
                >
                  {summary}
                  <ChevronDownSmall aria-hidden className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                </button>
              ) : (
                summary
              )}
            </ToastRow>
          </Face>
          {!!widget && (
            <Face isActive={isOpen} width={WIDGET_WIDTH} timing={WIDGET_FADE}>
              <ToastWidget ref={widgetRef} onCollapse={collapse}>
                <ToastIdContext value={toast.id}>{widget}</ToastIdContext>
              </ToastWidget>
            </Face>
          )}
        </div>
        {isTimed && (
          <div
            // Restarts on every update, and again when an opened toast collapses, so it doesn't vanish right after you close it.
            key={`${toast.version}-${isOpen}`}
            aria-hidden
            className="invisible absolute"
            style={{
              animation: `toast-countdown ${toast.duration}ms linear forwards`,
              animationPlayState: isPaused || isHidden ? 'paused' : 'running',
            }}
            onAnimationEnd={() => dismiss(toast.id)}
          />
        )}
      </li>
    </>
  );
}

type FadeTiming = { delay: number; duration: number };

/**
 * When each face fades in and out (ms), so the card reads as one continuous morph. Opening, the toast text clears at once and the
 * widget is there from the start, revealed by the growing card. Collapsing, the toast text starts blurring in as the card starts
 * shrinking and resolves with it, while the widget, clipped by the card, holds a beat before fading.
 */
const SUMMARY_FADE = { in: { delay: 0, duration: 400 }, out: { delay: 0, duration: 160 } } satisfies Record<'in' | 'out', FadeTiming>;
const WIDGET_FADE = { in: { delay: 0, duration: 200 }, out: { delay: 130, duration: 270 } } satisfies Record<'in' | 'out', FadeTiming>;

/**
 * One face of the card, at its own fixed width and centred, so the card morphs around it without reflowing it, like the Dynamic
 * Island. The active face is in flow and sets the card's height; the other lies over it, out of flow, and fades out.
 */
function Face({ isActive, width, timing, children }: { isActive: boolean; width: string; timing: Record<'in' | 'out', FadeTiming>; children: ReactNode }) {
  const { delay, duration } = isActive ? timing.in : timing.out;
  return (
    <div
      inert={!isActive}
      style={{ width, transitionDuration: slowmo(duration), transitionDelay: slowmo(delay) }}
      className={cn('left-1/2 -translate-x-1/2 transition-[opacity,filter]', isActive ? 'relative' : 'pointer-events-none absolute top-0 opacity-0 blur-[6px]')}
    >
      {children}
    </div>
  );
}

function ToastWidget({ ref, onCollapse, children }: { ref: RefObject<HTMLDivElement | null>; onCollapse: () => void; children: ReactNode }) {
  // Grows to the viewport (52px top offset + 16px gutter) and scrolls only past that.
  return (
    <div ref={ref} tabIndex={-1} className="max-h-[calc(100dvh-68px)] cursor-auto overflow-y-auto p-1.5 outline-none select-text">
      <div className="sticky top-0 z-10 flex h-0 justify-end">
        <Button variant="ghost" size="icon-xs" aria-label="Collapse" className="mt-2 mr-2 text-muted-foreground" onClick={onCollapse}>
          <ChevronUpSmall />
        </Button>
      </div>
      {children}
    </div>
  );
}

function withHeight(heights: Record<string, number>, id: string, height: number | null) {
  if (height === null) {
    const { [id]: _, ...rest } = heights;
    return rest;
  }
  return heights[id] === height ? heights : { ...heights, [id]: height };
}

function useMeasure(ref: RefObject<HTMLElement | null>, onHeight: (height: number | null) => void, isActive: boolean) {
  const report = useEffectEvent(onHeight);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !isActive) return;
    // offsetHeight, not the bounding rect: the stack scales items behind the front one.
    report(el.offsetHeight);
    const observer = new ResizeObserver(() => report(el.offsetHeight));
    observer.observe(el);
    return () => {
      observer.disconnect();
      report(null);
    };
  }, [ref, isActive]);
}

/** Popovers a widget opens portal out of the stack, so a click in one isn't a click outside. */
const PORTALED = '[data-radix-popper-content-wrapper], [data-slot$="-content"]';

function useCloseOnOutsidePointer(listRef: RefObject<HTMLElement | null>, isActive: boolean, onClose: () => void) {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!isActive) return;
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Element;
      if (listRef.current?.contains(target) || target.closest(PORTALED)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [listRef, isActive]);
}

function useIsWindowActive() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('focus', onChange);
      window.addEventListener('blur', onChange);
      document.addEventListener('visibilitychange', onChange);
      return () => {
        window.removeEventListener('focus', onChange);
        window.removeEventListener('blur', onChange);
        document.removeEventListener('visibilitychange', onChange);
      };
    },
    () => document.hasFocus() && !document.hidden,
  );
}

/** Alt+T jumps to the newest toast's first control, so an Undo is reachable without tabbing through the app. */
function useFocusHotkey(listRef: RefObject<HTMLOListElement | null>, isActive: boolean) {
  useEffect(() => {
    if (!isActive) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (!isCommand(e, 'toast-focus')) return;
      const target = listRef.current?.querySelector<HTMLElement>('li:not([inert]) button:not([inert] *)');
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
    return listenKeydown(onKeyDown);
  }, [listRef, isActive]);
}
