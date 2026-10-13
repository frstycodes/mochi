import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import { animate, motion, useDragControls, useMotionValue, type PanInfo } from 'motion/react';
import { ChevronLeft, ChevronRight, CommentPlus, ExitPip, X } from 'reicon-react';
import { host } from '@/host';
import { cn } from '@/lib/utils';
import { togglePick } from './browser/actions';
import { Annotator } from './browser/Annotate';
import { ComparePane } from './browser/Compare';
import { RESPONSIVE } from './browser/devices';
import { PageSurface, useSize } from './browser/PageSurface';
import { destroyPage, onOpenTab, pageKey, pageKeys, tabPageKey, usePage, type Page } from './browser/pages';
import { BrowserToolbar, DeviceBar, DriveBar } from './browser/Toolbar';
import { normalizeUrl } from './browser/url';
import type { Pane, PaneTab, Thread } from './model';
import { PANE_TABS, tabTitle } from './pane/tabs';
import { useHarness } from './store';

type Corner = 'tl' | 'tr' | 'bl' | 'br';

const PIP = { w: 360, h: 520 };
const MIN = { w: 240, h: 200 };
const SNAP = { type: 'spring', stiffness: 420, damping: 36 } as const;
const VELOCITY_PROJECTION = 0.12;
const TUCK_TAB = 28;
// Matches the layer's inset-3: the clip sits 12px outside the snap bounds.
const LAYER_INSET = 12;

export function BrowserView({ thread, tab, isDriving }: { thread: Thread; tab: PaneTab; isDriving: boolean }) {
  const { dispatch } = useHarness();
  const pageId = pageKey(thread.id, tab.id);
  const page = usePage(pageId, initialUrl(tab));
  useTabSync(thread.id, tab, page);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BrowserToolbar thread={thread} pageId={pageId} page={page} onPopOut={() => dispatch({ type: 'pane-pop', threadId: thread.id, tabId: tab.id, isPopped: true })} />
      {page.device !== RESPONSIVE && <DeviceBar pageId={pageId} page={page} />}
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
  const layerRef = useRef<HTMLDivElement>(null);
  const bounds = useSize(layerRef);
  const pane = state.panes.find((p) => p.threadId === thread.id);
  const popped = pane?.tabs.filter((t) => t.isPopped) ?? [];

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-3 isolate">
      {bounds.w > 0 && !!pane && popped.map((tab) => <PipWindow key={tab.id} thread={thread} pane={pane} tab={tab} isDriving={pane.driver === thread.providers[0] && thread.status === 'running'} bounds={bounds} />)}
    </div>
  );
}

function anchorFor(corner: Corner, w: number, h: number, bounds: { w: number; h: number }) {
  return { x: corner[1] === 'r' ? bounds.w - w : 0, y: corner[0] === 'b' ? bounds.h - h : 0 };
}

function PipWindow({ thread, pane, tab, isDriving, bounds }: { thread: Thread; pane: Pane; tab: PaneTab; isDriving: boolean; bounds: { w: number; h: number } }) {
  const { dispatch } = useHarness();
  const [corner, setCorner] = useState<Corner>('br');
  const [size, setSize] = useState(PIP);
  const [isTucked, setTucked] = useState(false);
  const controls = useDragControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const w = Math.min(size.w, bounds.w);
  const h = Math.min(size.h, bounds.h);
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
    const tuck = cx < 0 || cx > bounds.w;
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
    controls.start(e);
  };

  return (
    <motion.section
      aria-label={`Floating ${tabTitle(tab)}`}
      drag
      dragControls={controls}
      dragListener={false}
      dragMomentum={false}
      onDragEnd={onDragEnd}
      onPointerDown={startDrag}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
      style={{ left: anchor.x, top: anchor.y, width: w, height: h, x, y }}
      className={cn('group/pip pointer-events-auto absolute rounded-2xl bg-background shadow-float', !isTucked && 'cursor-grab active:cursor-grabbing')}
    >
      {/* Clip here, not on the section: Chromium drops a backdrop-filter's mask under a rounded overflow clip. */}
      <div inert={isTucked || undefined} className="h-full overflow-hidden rounded-[inherit]">
        {tab.kind === 'browser' ? (
          <PoppedPage thread={thread} tab={tab} isDriving={isDriving} />
        ) : (
          <PoppedTab thread={thread} pane={pane} tab={tab} />
        )}
      </div>

      {!isTucked && (
        <div className="pointer-events-none absolute top-0 left-0 isolate flex h-20 w-44 items-start gap-1 rounded-tl-[inherit] p-3 opacity-0 transition-opacity duration-150 group-hover/pip:pointer-events-auto group-hover/pip:opacity-100 group-focus-within/pip:pointer-events-auto group-focus-within/pip:opacity-100">
          <span aria-hidden className="pip-blur absolute inset-0 -z-10 rounded-tl-[inherit]" />
          <PipButton label={`Close ${tabTitle(tab)}`} onClick={() => dispatch({ type: 'pane-close-tab', threadId: thread.id, tabId: tab.id })}>
            <X />
          </PipButton>
          <PipButton label="Put back in the side pane" onClick={() => dispatch({ type: 'pane-pop', threadId: thread.id, tabId: tab.id, isPopped: false })}>
            <ExitPip />
          </PipButton>
          {tab.kind === 'browser' && <PipPickButton thread={thread} tab={tab} />}
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

function PoppedPage({ thread, tab, isDriving }: { thread: Thread; tab: PaneTab; isDriving: boolean }) {
  const pageId = pageKey(thread.id, tab.id);
  const page = usePage(pageId, initialUrl(tab));
  // The native view swallows the pointer, so on desktop the hover controls get a strip of their own above it.
  return (
    <div className={cn('h-full rounded-[inherit]', host.isDesktop && 'bg-sidebar pt-10')}>
      <PageSurface thread={thread} pageId={pageId} page={page} isDriving={isDriving && !page.hasTakenOver} className="rounded-[inherit]" />
    </div>
  );
}

function PipPickButton({ thread, tab }: { thread: Thread; tab: PaneTab }) {
  const pageId = pageKey(thread.id, tab.id);
  const page = usePage(pageId, initialUrl(tab));
  return (
    <PipButton label={page.isPicking ? 'Stop picking' : 'Pick an element to comment on'} pressed={page.isPicking} onClick={() => togglePick(pageId, page, thread)}>
      <CommentPlus />
    </PipButton>
  );
}

function PoppedTab({ thread, pane, tab }: { thread: Thread; pane: Pane; tab: PaneTab }) {
  const Content = PANE_TABS[tab.kind].component;
  return (
    <div className="h-full bg-sidebar pt-10">
      <Content thread={thread} pane={pane} tab={tab} />
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
      className={cn('flex size-8 cursor-default items-center justify-center rounded-full text-white/90 hover:bg-white/15 hover:text-white [&_svg]:size-5', pressed && 'bg-white/20')}
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
