import { useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { animate, motion, useDragControls, useMotionValue, type PanInfo } from 'motion/react';
import { ChevronLeft, ChevronRight, ExitPip, X } from 'reicon-react';
import { host } from '@/host';
import { cn } from '@/lib/utils';
import { Annotator } from './browser/Annotate';
import { ComparePane } from './browser/Compare';
import { RESPONSIVE } from './browser/devices';
import { deviceSize, PageSurface, useSize } from './browser/PageSurface';
import { FindBar } from './browser/FindBar';
import { destroyPage, ensureView, getPage, onOpenTab, openFind, pageKey, pageKeys, tabPageKey, usePage, viewportOf, type Page } from './browser/pages';
import { BrowserToolbar, DeviceBar, DriveBar } from './browser/Toolbar';
import { normalizeUrl } from './browser/url';
import type { Pane, PaneTab, Thread } from './model';
import { isTabOnScreen } from './store/panes';
import { PaneSlotBar, PaneSlots } from './pane/PaneHeader';
import { PANE_TABS, tabTitle } from './pane/tabs';
import { useHarness } from './store';
import { isWorking } from './agentPhase';
import { isCommand } from './keymap';
import { PreviewContext } from './layout/SplitContext';

type Corner = 'tl' | 'tr' | 'bl' | 'br';
type Viewport = { width: number; height: number };

const PIP = { w: 280, h: 420 };
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const MIN = { w: 200, h: 160 };
// Soft with a hint of overshoot, carrying the throw's velocity into the snap.
const SNAP = { type: 'spring', stiffness: 260, damping: 26 } as const;
const VELOCITY_PROJECTION = 0.2;
const TUCK_TAB = 28;
// Matches the layer's inset-3: the clip sits 12px outside the snap bounds.
const LAYER_INSET = 12;

export function BrowserView({ thread, tab, isDriving }: { thread: Thread; tab: PaneTab; isDriving: boolean }) {
  const pageId = pageKey(thread.id, tab.id);
  const page = usePage(pageId, initialUrl(tab));
  useTabSync(thread.id, tab, page);

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if (!isCommand(e, 'find')) return;
        e.preventDefault();
        openFind(pageId);
      }}
    >
      <BrowserToolbar thread={thread} pageId={pageId} page={page} />
      {page.device !== RESPONSIVE && <DeviceBar pageId={pageId} page={page} />}
      {!!page.find && <FindBar pageId={pageId} page={page} find={page.find} />}
      {isDriving && <DriveBar thread={thread} pageId={pageId} hasTakenOver={page.hasTakenOver} />}
      <div className="min-h-0 flex-1">
        {page.annotating ? (
          <Annotator thread={thread} pageId={pageId} image={page.annotating.image} name={page.annotating.name} />
        ) : page.compare ? (
          <ComparePane thread={thread} pageId={pageId} page={page} compare={page.compare} />
        ) : (
          <PageSurface thread={thread} pageId={pageId} page={page} isDriving={isDriving && !page.hasTakenOver} />
        )}
      </div>
    </div>
  );
}

function initialUrl(tab: PaneTab) {
  return host.isDesktop ? normalizeUrl(tab.url ?? '') : (tab.url ?? 'about:blank');
}

/** The pane tab persists the page's URL and shows its title. */
function useTabSync(threadId: string, tab: PaneTab, page: Page) {
  const { dispatch } = useHarness();
  const title = page.title || tab.title;
  useEffect(() => {
    if (page.url === tab.url && title === tab.title) return;
    dispatch({ type: 'pane-update-tab', threadId, tabId: tab.id, patch: { url: page.url, title } });
  }, [dispatch, threadId, tab.id, tab.url, tab.title, page.url, title]);
}

/** Closed tabs free their native view; links that open a new window land in a new browser tab instead. */
function useBrowserHousekeeping() {
  const { state, dispatch } = useHarness();
  useEffect(
    () =>
      onOpenTab((pageId, url) => {
        const [threadId] = pageId.split('/');
        dispatch({ type: 'pane-open-tab', threadId, kind: 'browser', url });
      }),
    [dispatch],
  );
  useEffect(() => {
    const live = new Set(state.panes.flatMap((p) => p.tabs.map((t) => pageKey(p.threadId, t.id))));
    pageKeys()
      .filter((key) => !live.has(tabPageKey(key)))
      .forEach(destroyPage);
  }, [state.panes]);
}

export function PipLayer({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  useBrowserHousekeeping();
  const anchorRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const previewSize = useSize(layerRef);
  const isPreview = useContext(PreviewContext);
  const pane = state.panes.find((p) => p.threadId === thread.id);
  const floating = pane ? floatingTabs(thread, pane) : [];
  const rect = useTrackedRect(anchorRef, floating.length > 0 && !isPreview);
  const bounds = isPreview ? previewSize : { w: Math.max(0, (rect?.width ?? 0) - 2 * LAYER_INSET), h: Math.max(0, (rect?.height ?? 0) - 2 * LAYER_INSET) };

  const layer = (
    <div ref={isPreview ? layerRef : undefined} className="pointer-events-none absolute inset-3 isolate">
      {bounds.w > 0 && !!pane && floating.map((tab) => <PipWindow key={tab.id} thread={thread} pane={pane} tab={tab} bounds={bounds} />)}
    </div>
  );
  // Previews (Stage, swipe neighbours) stay clipped in place; the live thread's windows sit above the whole app so the hover
  // blur isn't cut off by the header or sidebar. The clip only returns to hide a tucked window.
  if (isPreview) return <div className="pointer-events-none absolute inset-0 overflow-hidden">{layer}</div>;
  return (
    <div ref={anchorRef} className="pointer-events-none absolute inset-0">
      {!!rect &&
        createPortal(
          <div className="pointer-events-none fixed z-40 has-[[data-tucked]]:overflow-hidden" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
            {layer}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** The element's viewport rect, followed every frame while `isOn`: it moves with the sidebar, splits and the side pane. */
function useTrackedRect(ref: RefObject<HTMLElement | null>, isOn: boolean) {
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!isOn) return setRect(null);
    let frame = 0;
    let last = '';
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const r = ref.current?.getBoundingClientRect();
      const next = r && r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
      const key = JSON.stringify(next);
      if (key === last) return;
      last = key;
      setRect(next);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [ref, isOn]);
  return rect;
}

/** The browser tab the agent is driving right now, if any. */
export function drivenTab(thread: Thread, pane: Pane) {
  if (!isWorking(thread)) return undefined;
  return pane.tabs.find((t) => t.id === pane.drivenTab && t.kind === 'browser');
}

/** Tabs you popped out, plus the agent's browser while it works off screen. Browser tabs never float on their own. */
function floatingTabs(thread: Thread, pane: Pane) {
  const driven = drivenTab(thread, pane);
  const isDrivenHidden = !!driven && !isTabOnScreen(pane, driven);
  return pane.tabs.filter((t) => (t.isPopped && t.kind !== 'browser') || (isDrivenHidden && t === driven));
}

function anchorFor(corner: Corner, w: number, h: number, bounds: { w: number; h: number }) {
  return { x: corner[1] === 'r' ? bounds.w - w : 0, y: corner[0] === 'b' ? bounds.h - h : 0 };
}

/** Width and height inside the layer; a mirrored page keeps its viewport's aspect ratio. */
function fitWindow(size: { w: number; h: number }, aspect: number | null, bounds: { w: number; h: number }) {
  if (!aspect) return { w: Math.min(size.w, bounds.w), h: Math.min(size.h, bounds.h) };
  const w = Math.min(size.w, bounds.w, bounds.h / aspect);
  return { w, h: w * aspect };
}

function PipWindow({ thread, pane, tab, bounds }: { thread: Thread; pane: Pane; tab: PaneTab; bounds: { w: number; h: number } }) {
  const { dispatch } = useHarness();
  const [corner, setCorner] = useState<Corner>('br');
  const [size, setSize] = useState(PIP);
  const [isTucked, setTucked] = useState(false);
  const controls = useDragControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const isBrowser = tab.kind === 'browser';
  const viewport = mirrorViewport(thread, tab);
  const { w, h } = fitWindow(size, viewport && viewport.height / viewport.width, bounds);
  const anchor = anchorFor(corner, w, h, bounds);
  const tuckSide = corner[1] === 'r' ? 1 : -1;
  const tuckOffset = isTucked ? tuckSide * (w - TUCK_TAB + LAYER_INSET) : 0;

  useEffect(() => {
    animate(x, tuckOffset, SNAP);
    if (isTucked) animate(y, 0, SNAP);
  }, [tuckOffset, isTucked, x, y]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const cx = anchor.x + x.get() + info.velocity.x * VELOCITY_PROJECTION + w / 2;
    const cy = anchor.y + y.get() + info.velocity.y * VELOCITY_PROJECTION + h / 2;
    const next = `${cy < bounds.h / 2 ? 't' : 'b'}${cx < bounds.w / 2 ? 'l' : 'r'}` as Corner;
    // The throw picks the corner; only the window's own position past an edge tucks it, so a flick never overshoots into a tuck.
    const at = anchor.x + x.get() + w / 2;
    const tuck = at < 0 || at > bounds.w;
    const from = { x: anchor.x + x.get(), y: anchor.y + y.get() };
    const to = anchorFor(next, w, h, bounds);
    flushSync(() => setCorner(next));
    x.set(from.x - to.x);
    y.set(from.y - to.y);
    setTucked(tuck);
    if (tuck) return;
    animate(x, 0, { ...SNAP, velocity: info.velocity.x });
    animate(y, 0, { ...SNAP, velocity: info.velocity.y });
  };

  const startDrag = (e: ReactPointerEvent) => {
    if (isTucked) return;
    // Stops the press from starting a text selection across the chat as the pointer moves.
    e.preventDefault();
    controls.start(e);
  };
  const close = () => (isBrowser ? dispatch({ type: 'pane-drive', threadId: thread.id, tabId: undefined }) : dispatch({ type: 'pane-close-tab', threadId: thread.id, tabId: tab.id }));

  return (
    <motion.section
      aria-label={`Floating ${tabTitle(tab)}`}
      // A pause before dragging shouldn't open Orbit's long-press menu.
      data-no-orbit
      data-tucked={isTucked || undefined}
      drag
      dragControls={controls}
      dragListener={false}
      dragMomentum={false}
      onDragEnd={onDragEnd}
      onPointerDown={startDrag}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      whileDrag={{ scale: 1.03 }}
      transition={{ opacity: { duration: 0.18, ease: [0.23, 1, 0.32, 1] }, scale: { type: 'spring', visualDuration: 0.3, bounce: 0.15 } }}
      style={{ left: anchor.x, top: anchor.y, width: w, height: h, x, y }}
      className={cn('group/pip pointer-events-auto absolute rounded-2xl bg-background shadow-[0_0_0_1px_var(--border),0_32px_80px_-16px_oklch(0_0_0/0.45),0_12px_28px_-10px_oklch(0_0_0/0.3)]', !isTucked && 'cursor-grab active:cursor-grabbing')}
    >
      {/* Clip here, not on the section: Chromium drops a backdrop-filter's mask under a rounded overflow clip. */}
      <div inert={isTucked || undefined} className="h-full overflow-hidden rounded-[inherit]">
        {viewport ? <MirroredPage thread={thread} tab={tab} viewport={viewport} width={w} /> : <PoppedTab thread={thread} pane={pane} tab={tab} />}
      </div>

      {!isTucked && (
        // Sticks out past the corner like Codex. A sibling of the buttons, not inside their fade: under opacity < 1 a backdrop blur goes black.
        <span aria-hidden className="pip-scrim pointer-events-none absolute -top-8 -left-14 h-28 w-48">
          <span />
          <span />
          <span />
        </span>
      )}
      {!isTucked && (
        <div className="pointer-events-none absolute top-0 left-0 flex items-start gap-1 p-2 opacity-0 transition-opacity duration-150 group-focus-within/pip:pointer-events-auto group-focus-within/pip:opacity-100 group-hover/pip:pointer-events-auto group-hover/pip:opacity-100">
          <PipButton label={isBrowser ? 'Hide until the agent browses again' : `Close ${tabTitle(tab)}`} onClick={close}>
            <X />
          </PipButton>
          <PipButton label="Open in the side pane" onClick={() => dispatch({ type: 'pane-pop', threadId: thread.id, tabId: tab.id, isPopped: false })}>
            <ExitPip />
          </PipButton>
        </div>
      )}

      {isTucked && (
        <button
          type="button"
          aria-label={`Show ${tabTitle(tab)}`}
          onClick={() => setTucked(false)}
          className={cn('absolute inset-y-0 z-10 flex items-center justify-center bg-popover text-muted-foreground hover:text-foreground', tuckSide === 1 ? 'left-0 rounded-l-[inherit]' : 'right-0 rounded-r-[inherit]')}
          style={{ width: TUCK_TAB }}
        >
          {tuckSide === 1 ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
      )}
      {!isTucked && <ResizeHandle corner={corner} start={{ w, h }} onResize={(nw, nh) => setSize({ w: clamp(nw, MIN.w, bounds.w), h: clamp(nh, MIN.h, bounds.h) })} />}
    </motion.section>
  );
}

/** The size the page renders at while it floats: its device, else the size it last had on screen. */
function mirrorViewport(thread: Thread, tab: PaneTab): Viewport | null {
  if (tab.kind !== 'browser') return null;
  const pageId = pageKey(thread.id, tab.id);
  const page = getPage(pageId);
  const device = page && deviceSize(page);
  if (!device) return viewportOf(pageId) ?? DEFAULT_VIEWPORT;
  return page.isRotated ? { width: device.height, height: device.width } : device;
}

/** The agent's page at its real viewport, scaled down to the window and out of reach: you watch, the agent drives. */
function MirroredPage({ thread, tab, viewport, width }: { thread: Thread; tab: PaneTab; viewport: Viewport; width: number }) {
  const pageId = pageKey(thread.id, tab.id);
  const page = usePage(pageId, initialUrl(tab));
  if (host.isDesktop) return <FrameStream pageId={pageId} hostId={page.hostId} spaceId={thread.spaceId} viewport={viewport} />;
  return (
    <div inert className="pointer-events-none origin-top-left" style={{ width: viewport.width, height: viewport.height, transform: `scale(${width / viewport.width})` }}>
      <PageSurface thread={thread} pageId={pageId} page={page} isDriving={false} />
    </div>
  );
}

/** The native view can't sit under DOM, so the window shows frames of it instead, written straight to the img. */
function FrameStream({ pageId, hostId, spaceId, viewport: { width, height } }: { pageId: string; hostId: string | null; spaceId: string; viewport: Viewport }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const isPreview = useContext(PreviewContext);
  useEffect(() => void ensureView(pageId, spaceId), [pageId, spaceId]);
  useEffect(() => {
    if (!hostId || isPreview) return;
    const off = host.browser.onEvent((e) => {
      if (e.id === hostId && e.type === 'frame' && imgRef.current) imgRef.current.src = e.data;
    });
    void host.browser.mirror(hostId, { width, height });
    return () => {
      off();
      void host.browser.mirror(hostId, null).catch(() => {});
    };
  }, [hostId, isPreview, width, height]);
  return <img ref={imgRef} alt="" draggable={false} className="size-full bg-white object-cover object-top" />;
}

function PoppedTab({ thread, pane, tab }: { thread: Thread; pane: Pane; tab: PaneTab }) {
  const Content = PANE_TABS[tab.kind].component;
  return (
    <div className="flex h-full flex-col bg-card">
      <PaneSlots>
        <PaneSlotBar />
        <div className="min-h-0 flex-1">
          <Content thread={thread} pane={pane} tab={tab} />
        </div>
      </PaneSlots>
    </div>
  );
}

function PipButton({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={cn('flex size-8 cursor-default items-center justify-center rounded-full text-white/90 drop-shadow-[0_1px_3px_oklch(0_0_0/0.6)] hover:bg-white/15 hover:text-white [&_svg]:size-5', pressed && 'bg-white/20')}
    >
      {children}
    </button>
  );
}

function ResizeHandle({ corner, start, onResize }: { corner: Corner; start: { w: number; h: number }; onResize: (w: number, h: number) => void }) {
  const sx = corner[1] === 'r' ? -1 : 1;
  const sy = corner[0] === 'b' ? -1 : 1;
  const origin = useRef<{ px: number; py: number; w: number; h: number } | null>(null);
  return (
    <span
      aria-hidden
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = { px: e.clientX, py: e.clientY, w: start.w, h: start.h };
      }}
      onPointerMove={(e) => {
        const o = origin.current;
        if (o) onResize(o.w + sx * (e.clientX - o.px), o.h + sy * (e.clientY - o.py));
      }}
      onPointerUp={() => (origin.current = null)}
      className={cn('absolute size-5 touch-none', sx === -1 ? 'left-0' : 'right-0', sy === -1 ? 'top-0' : 'bottom-0', sx === sy ? 'cursor-nwse-resize' : 'cursor-nesw-resize')}
    />
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}
