import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { ArrowDown2, ArrowUp2, CheckCircle, CloseCircle, InfoCircle, Loader, Warning, X } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ToastIdContext } from './context';
import { dismiss, getToasts, subscribe, type Toast, type ToastType } from './store';

const VISIBLE = 3;
const GAP = 8;
const PEEK = 10;
const SWIPE_PX = 40;
/** How far an opened toast grows past the stack on each side, never past a 16px gutter. */
const GROWTH = 'clamp(0px, (100vw - 388px) / 2, 32px)';
const OPEN_INSET = `calc(-1 * ${GROWTH})`;

/** A toast duration, stretched by `--toast-slowmo` (unset = 1) so the motion can be studied frame by frame. */
const slowmo = (ms: number) => `calc(${ms}ms * var(--toast-slowmo, 1))`;
/** Widths of the card's two faces; `cqw` is the stack's own width. */
const SUMMARY_WIDTH = '100cqw';
const WIDGET_WIDTH = `calc(100cqw + 2 * ${GROWTH})`;

/**
 * Top-center stack: collapsed it shows the newest with two peeking behind; hover or focus fans it out and pauses every countdown.
 * A toast with an `expand` widget opens in place into it, like the Dynamic Island, and the rest of the stack steps aside.
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getToasts);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [isHovered, setHovered] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const isWindowActive = useIsWindowActive();
  const listRef = useRef<HTMLOListElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useFocusHotkey(listRef, toasts.length > 0);

  const isEmpty = toasts.length === 0;
  useEffect(() => {
    if (isEmpty) setHovered(false);
  }, [isEmpty]);

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

  const isExpanded = !open && !isHeldFolded && (isHovered || hasFocus);
  const slots = open ? openSlots(toasts, open.id) : stackSlots(toasts, heights);
  const frontHeight = heights[(open ?? live[0])?.id] ?? 0;
  const height = open ? frontHeight : isExpanded ? slots.total : frontHeight + Math.min(live.length - 1, VISIBLE - 1) * PEEK;

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
        onPointerMove={() => isHeldFolded && setHeldFolded(false)}
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
            onHeight={(h) => setHeights((all) => (all[t.id] === h ? all : { ...all, [t.id]: h }))}
            onOpen={() => setOpenId(t.id)}
            onCollapse={collapse}
            onKeyboardClose={() => closeFromKeyboard(t.id)}
          />
        ))}
      </ol>
    </section>
  );
}

type Slot = { index: number; y: number };

/** Leaving toasts hold their spot while they fade; the live ones close the gap behind them. */
function stackSlots(toasts: Toast[], heights: Record<string, number>) {
  const byId: Record<string, Slot> = {};
  let index = 0;
  let y = 0;
  for (const t of toasts) {
    byId[t.id] = { index, y };
    if (t.isLeaving) continue;
    index++;
    y += (heights[t.id] ?? 0) + GAP;
  }
  return { byId, total: Math.max(y - GAP, 0) };
}

/** The opened toast takes the front; every other one counts as past the visible three, so it fades and its timer waits. */
function openSlots(toasts: Toast[], openId: string) {
  const byId = Object.fromEntries(toasts.map((t) => [t.id, t.id === openId ? { index: 0, y: 0 } : { index: VISIBLE, y: 0 }]));
  return { byId, total: 0 };
}

type ToastItemProps = {
  toast: Toast;
  slot: Slot;
  frontHeight: number;
  height: number;
  isExpanded: boolean;
  isOpen: boolean;
  isPaused: boolean;
  onHeight: (height: number) => void;
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
  const swipe = useSwipe(() => dismiss(toast.id), !isOpen);
  useMeasure(contentRef, onHeight);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  // A decision in the widget swaps the toast for its outcome and drops `expand`; the last widget stays mounted to fade out while
  // the card shrinks into the outcome, instead of vanishing on the first frame.
  const [widget, setWidget] = useState(toast.expand);
  if (toast.expand && toast.expand !== widget) setWidget(toast.expand);

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
  const transform = itemTransform({ slot, isExpanded, isMounted, isLeaving: toast.isLeaving, offset: swipe.offset });

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
    'absolute inset-x-0 top-0 origin-top rounded-xl transition-[transform,opacity,filter,left,right,height,border-radius] motion-reduce:transition-opacity',
    // Stack movement eases out; the card's size and corners keep the drawer curve both ways, so closing doesn't switch curves
    // mid-morph. Same order as the property list above.
    '[transition-timing-function:var(--ease-out),var(--ease-out),var(--ease-out),var(--ease-drawer),var(--ease-drawer),var(--ease-drawer),var(--ease-drawer)]',
    swipe.isDragging && 'transition-none',
    (!isMounted || toast.isLeaving || isHidden) && 'opacity-0 blur-[6px]',
  );
  // An explicit, transitioned height: the card morphs on open and whenever the widget inside changes size.
  const size = { height: (isCollapsedBehind ? frontHeight : height) || undefined, ...(isOpen && { left: OPEN_INSET, right: OPEN_INSET }) };
  const motionStyle = { transform, ...size, transitionDuration: slowmo(toast.isLeaving ? 200 : 300) };

  const summary = (
    <>
      <ToastIcon type={toast.type} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 type-body font-medium [overflow-wrap:anywhere]">{toast.title}</p>
          {toast.count > 1 && <RepeatCount count={toast.count} />}
        </div>
        {!!toast.description && (
          <div
            data-selectable={!toast.expand || undefined}
            className={cn('type-meta text-muted-foreground [overflow-wrap:anywhere]', !toast.expand && 'cursor-text select-text')}
          >
            {toast.description}
          </div>
        )}
      </div>
    </>
  );

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
        {...swipe.handlers}
        className={cn(
          motionClass,
          // `overflow-clip`, not `hidden`: a hidden box is still scrollable, so a widget focusing a field below the card's
          // animating height scrolled the content up, then back down as the card grew.
          'touch-none overflow-clip bg-popover text-popover-foreground shadow-[0_0_0_1px_var(--border)] select-none',
          isOpen && 'rounded-2xl',
        )}
        style={{ ...motionStyle, zIndex: 1 + VISIBLE - slot.index }}
      >
        <div ref={contentRef} style={{ transitionDuration: slowmo(200) }} className={cn('relative transition-opacity', isCollapsedBehind && 'opacity-0')}>
          <Face isActive={!isOpen} width={SUMMARY_WIDTH} timing={SUMMARY_FADE}>
            <div className="flex items-start gap-2.5 py-2.5 pr-2 pl-3">
              {toast.expand ? (
                <button
                  ref={openerRef}
                  type="button"
                  aria-expanded={isOpen}
                  className="-my-1 -ml-1.5 flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 rounded-lg py-1 pl-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => !swipe.wasDragged() && onOpen()}
                >
                  {summary}
                  <ArrowDown2 aria-hidden className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                </button>
              ) : (
                summary
              )}
              {!!toast.action && (
                <Button data-toast-control size="sm" variant="outline" onClick={runAction}>
                  {toast.action.label}
                </Button>
              )}
              <Button
                data-toast-control
                data-toast-close
                variant="ghost"
                size="icon-xs"
                aria-label="Dismiss"
                className="mt-0.5 text-muted-foreground"
                onClick={(e) => (e.detail === 0 ? onKeyboardClose() : dismiss(toast.id))}
              >
                <X />
              </Button>
            </div>
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
              animationPlayState: isPaused || isHidden || swipe.isDragging ? 'paused' : 'running',
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
const SUMMARY_FADE = { in: { delay: 0, duration: 300 }, out: { delay: 0, duration: 120 } } satisfies Record<'in' | 'out', FadeTiming>;
const WIDGET_FADE = { in: { delay: 0, duration: 150 }, out: { delay: 100, duration: 200 } } satisfies Record<'in' | 'out', FadeTiming>;

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
    <div ref={ref} tabIndex={-1} data-toast-control className="max-h-[calc(100dvh-68px)] cursor-auto overflow-y-auto outline-none select-text">
      <div className="sticky top-0 z-10 flex h-0 justify-end">
        <Button variant="ghost" size="icon-xs" aria-label="Collapse" className="mt-2 mr-2 text-muted-foreground" onClick={onCollapse}>
          <ArrowUp2 />
        </Button>
      </div>
      {children}
    </div>
  );
}

function itemTransform({
  slot,
  isExpanded,
  isMounted,
  isLeaving,
  offset,
}: {
  slot: Slot;
  isExpanded: boolean;
  isMounted: boolean;
  isLeaving: boolean;
  offset: { x: number; y: number };
}) {
  if (!isMounted) return 'translateY(-100%)';
  const stackY = isExpanded ? slot.y : slot.index * PEEK;
  const scale = isExpanded ? 1 : 1 - Math.min(slot.index, VISIBLE) * 0.05;
  const isSwiped = offset.x !== 0 || offset.y !== 0;
  if (isLeaving && isSwiped) return `translate(${offset.x * 2}px, ${stackY + Math.min(offset.y, 0) * 2}px) scale(${scale})`;
  if (isLeaving) return `translateY(${stackY - 16}px) scale(${scale})`;
  return `translate(${offset.x}px, ${stackY + offset.y}px) scale(${scale})`;
}

const ICONS = {
  default: null,
  success: <CheckCircle className="size-4 text-success" />,
  info: <InfoCircle className="size-4 text-info" />,
  warning: <Warning className="size-4 text-warning" />,
  error: <CloseCircle className="size-4 text-destructive" />,
  loading: <Loader className="size-4 animate-spin text-muted-foreground motion-reduce:animate-[spin_2s_linear_infinite]" />,
} satisfies Record<ToastType, unknown>;

function ToastIcon({ type }: { type: ToastType }) {
  const icon = ICONS[type];
  return (
    !!icon && (
      <span aria-hidden className="mt-0.5 flex shrink-0">
        {icon}
      </span>
    )
  );
}

function RepeatCount({ count }: { count: number }) {
  return (
    <span aria-label={`Shown ${count} times`} className="shrink-0 rounded-full bg-muted px-1.5 type-caption font-medium text-muted-foreground tabular">
      {count}
    </span>
  );
}

function useMeasure(ref: RefObject<HTMLElement | null>, onHeight: (height: number) => void) {
  const latest = useRef(onHeight);
  latest.current = onHeight;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsetHeight, not the bounding rect: the stack scales items behind the front one.
    latest.current(el.offsetHeight);
    const observer = new ResizeObserver(() => latest.current(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}

/**
 * Drag sideways or up to dismiss; dragging down only gives a little. Controls and the selectable description don't start a drag.
 * The pointer is captured only once it moves: capturing on press would retarget the click away from the toast's own button.
 */
function useSwipe(onSwipe: () => void, isEnabled: boolean) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setDragging] = useState(false);

  const end = (e: PointerEvent) => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    const isPastThreshold = Math.abs(offset.x) > SWIPE_PX || offset.y < -SWIPE_PX;
    if (isPastThreshold && e.type === 'pointerup') return onSwipe();
    setOffset({ x: 0, y: 0 });
  };

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      dragged.current = false;
      if (!isEnabled || e.button !== 0 || (e.target as Element).closest('[data-toast-control], [data-selectable]')) return;
      start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e: PointerEvent) => {
      if (!start.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      if (!dragged.current && Math.hypot(dx, dy) < 4) return;
      if (!dragged.current) e.currentTarget.setPointerCapture(e.pointerId);
      dragged.current = true;
      setDragging(true);
      setOffset(Math.abs(dx) > Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: dy < 0 ? dy : dy * 0.2 });
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
  return { offset, isDragging, handlers, wasDragged: () => dragged.current };
}

/** Popovers a widget opens portal out of the stack, so a click in one isn't a click outside. */
const PORTALED = '[data-radix-popper-content-wrapper], [data-slot$="-content"]';

function useCloseOnOutsidePointer(listRef: RefObject<HTMLElement | null>, isActive: boolean, onClose: () => void) {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    if (!isActive) return;
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Element;
      if (listRef.current?.contains(target) || target.closest(PORTALED)) return;
      latest.current();
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
      if (!e.altKey || e.metaKey || e.ctrlKey || e.code !== 'KeyT') return;
      const target = listRef.current?.querySelector<HTMLElement>('li:not([inert]) button:not([inert] *)');
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [listRef, isActive]);
}
