import { useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Danger } from '@/icons';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { host } from '@/host';
import { cn } from '@/lib/utils';
import type { Thread } from '@/model';
import { PreviewContext } from '../layout/SplitContext';
import { pickDemoElement } from './actions';
import { DemoPage } from './DemoPage';
import { PageMenu } from './PageMenu';
import { DEVICES, fitDevice } from './devices';
import { emulationOf, ensureView, rememberViewport, type Page } from './pages';

// Open overlays the native view would paint over. Tooltips are left out: they'd swap the page for its snapshot on every hover.
const OVERLAYS = [
  '[role=dialog]',
  '[role=menu]',
  '[role=listbox]',
  '[data-slot=popover-content]',
  '[data-slot=hover-card-content]',
  '[data-slot=dialog-overlay]',
  '[data-slot=alert-dialog-overlay]',
  '[data-slot=sheet-overlay]',
  '[data-slot=drawer-overlay]',
  // Streamdown's "Open external link?" modal: a plain div, no dialog role.
  '[data-streamdown=link-safety-modal]',
  '[data-toast-id]',
].join(', ');
// How often the stand-in snapshot refreshes while an overlay stays open, so a playing video or a loading page still moves.
const PEEK_MS = 400;
// The native view takes an IPC round trip to reappear; the snapshot stays under it that long so nothing blinks.
const UNCOVER_HOLD_MS = 150;

/** The page itself: a native view placed over this box on desktop, an iframe (or the demo page) on the web. */
export function PageSurface({ thread, pageId, page, isDriving, className }: { thread: Thread; pageId: string; page: Page; isDriving: boolean; className?: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const size = useSize(frameRef);
  const device = deviceSize(page);
  const fit = device && size.w > 0 ? fitDevice({ width: size.w, height: size.h }, device, page.isRotated) : null;
  const standInRef = useNativeView(frameRef, page, device);
  useEmulation(page, fit);
  useEffect(() => void ensureView(pageId, thread.spaceId), [pageId, thread.spaceId]);
  useEffect(() => {
    if (size.w > 0 && size.h > 0) rememberViewport(pageId, { width: size.w, height: size.h });
  }, [pageId, size.w, size.h]);

  return (
    <div ref={frameRef} className={cn('relative h-full overflow-hidden bg-background', isDriving && 'ring-2 ring-foreground/25 ring-inset', !!device && 'bg-muted/40', className)}>
      {page.error && <PageError error={page.error} onRetry={() => page.hostId && host.browser.command(page.hostId, 'reload')} />}
      {host.isDesktop && <img ref={standInRef} alt="" aria-hidden hidden draggable={false} className="pointer-events-none absolute select-none" />}
      {!!page.menu && <PageMenu thread={thread} pageId={pageId} page={page} menu={page.menu} at={{ x: (fit?.x ?? 0) + page.menu.x, y: (fit?.y ?? 0) + page.menu.y }} />}
      {!host.isDesktop && size.w > 0 && (
        <div
          className={cn('absolute origin-top-left overflow-hidden', fit && 'shadow-popover')}
          style={fit ? { left: fit.x, top: fit.y, width: fit.cssWidth, height: fit.cssHeight, transform: `scale(${fit.scale})` } : { inset: 0 }}
        >
          {isDemoUrl(page.url) ? (
            <DemoPage
              thread={thread}
              width={fit?.cssWidth ?? size.w}
              height={fit?.cssHeight ?? size.h}
              isDriving={isDriving}
              isPicking={page.isPicking}
              onPick={(target) => pickDemoElement(pageId, thread, target)}
            />
          ) : (
            <iframe
              key={page.reloads}
              title={page.title || page.url}
              src={page.url}
              // No allow-top-navigation / allow-popups: the page can't replace the app or open windows.
              sandbox="allow-scripts allow-forms allow-same-origin allow-modals"
              className="size-full border-0 bg-white"
            />
          )}
        </div>
      )}
    </div>
  );
}

// GAP: fixture tabs store scheme-less URLs of dev servers that don't run in the web build, so those show the demo page.
export function isDemoUrl(url: string) {
  return !host.isDesktop && !/^([a-z]+:\/\/|about:)/i.test(url);
}

function PageError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <Empty className="absolute inset-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Danger />
        </EmptyMedia>
        <EmptyTitle>Can't reach this page</EmptyTitle>
        <EmptyDescription className="font-mono break-all">{error}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function deviceSize(page: Page) {
  if (page.device === 'custom') return page.custom;
  return DEVICES.find((d) => d.id === page.device) ?? null;
}

/**
 * Keeps the native view glued to the frame every frame: cheaper than tracking every layout cause (pane resize, split,
 * PiP drag, sidebar slide) and never a frame stale. Hidden while unmounted or errored.
 *
 * The native view paints above all DOM, so an overlay over it (menu, popover, dialog) would be hidden behind the page. While one
 * intersects the view, a snapshot of the page stands in for it in the DOM, under the overlay, refreshed every PEEK_MS; the view
 * hides only once the first snapshot is decoded, so the page never goes blank. Overlays elsewhere leave the view alone.
 * Returns the ref for the stand-in `<img>`, which this hook positions and fills directly, without React renders.
 */
function useNativeView(frameRef: RefObject<HTMLDivElement | null>, page: Page, device: { width: number; height: number } | null) {
  const params = useRef({ page, device });
  params.current = { page, device };
  const standInRef = useRef<HTMLImageElement>(null);
  const isPreview = useContext(PreviewContext);
  const id = isPreview ? undefined : page.hostId;

  useEffect(() => {
    if (!id) return;
    // An inert copy of this surface (the sidebar peek's thumbnail) would pull the one native view onto itself, then hide it on
    // unmount while the real surface's deduped loop never resends: it gets a still snapshot instead and never drives the view.
    if (frameRef.current?.closest('[inert]')) return showSnapshot(id, standInRef);
    let last = '';
    let frame = 0;
    let isCovered = false;
    let isStanding = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Bumped on every cover and uncover, so a snapshot still in flight from an earlier cover can't land.
    let generation = 0;

    const refresh = async (g: number) => {
      const src = await host.browser.peek(id).catch(() => null);
      const img = standInRef.current;
      if (src && img) {
        // Decoded off to the side first, so swapping the visible image's src never shows an empty frame.
        const next = new Image();
        next.src = src;
        await next.decode().catch(() => {});
        if (g !== generation) return;
        img.src = src;
        img.hidden = false;
        isStanding = true;
      }
      if (g === generation) timer = setTimeout(() => void refresh(g), PEEK_MS);
    };
    const cover = () => {
      isCovered = true;
      clearTimeout(timer);
      void refresh(++generation);
    };
    const uncover = () => {
      isCovered = false;
      isStanding = false;
      generation++;
      clearTimeout(timer);
      timer = setTimeout(() => standInRef.current && (standInRef.current.hidden = true), UNCOVER_HOLD_MS);
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const el = frameRef.current;
      if (!el) return;
      const { page, device } = params.current;
      const r = el.getBoundingClientRect();
      const fit = device ? fitDevice({ width: r.width, height: r.height }, device, page.isRotated) : null;
      const placed = !!page.error || r.width < 1 || r.height < 1 ? null : fit ? { x: r.x + fit.x, y: r.y + fit.y, width: fit.width, height: fit.height, radius: 0 } : { x: r.x, y: r.y, width: r.width, height: r.height, radius: roundRadius(el) };
      const isOverlaid = !!placed && isCoveredAt(el, placed);
      if (isOverlaid !== isCovered) (isOverlaid ? cover : uncover)();
      const img = standInRef.current;
      if (img && placed) Object.assign(img.style, { left: `${placed.x - r.x}px`, top: `${placed.y - r.y}px`, width: `${placed.width}px`, height: `${placed.height}px` });
      const bounds = isStanding ? null : placed;
      const zoom = page.zoom;
      // ⌘+ / ⌘− can leave the CSS rect unchanged while main's conversion to window DIPs changes; the ratio forces a resend.
      const next = JSON.stringify([bounds, zoom, window.devicePixelRatio]);
      if (next === last) return;
      last = next;
      void host.browser.setBounds(id, bounds);
      void host.browser.setZoom(id, zoom);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      generation++;
      if (standInRef.current) standInRef.current.hidden = true;
      void host.browser.setBounds(id, null).catch(() => {});
    };
  }, [id, frameRef]);
  return standInRef;
}

function showSnapshot(id: string, standInRef: RefObject<HTMLImageElement | null>) {
  let isLive = true;
  void host.browser
    .peek(id)
    .then((src) => {
      const img = standInRef.current;
      if (!isLive || !img) return;
      Object.assign(img.style, { left: '0px', top: '0px', width: '100%', height: '100%' });
      img.src = src;
      img.hidden = false;
    })
    .catch(() => {});
  return () => {
    isLive = false;
  };
}

function useEmulation(page: Page, fit: ReturnType<typeof fitDevice> | null) {
  const emulation = JSON.stringify(emulationOf(page, fit));
  const id = page.hostId;
  useEffect(() => {
    if (id) void host.browser.emulate(id, JSON.parse(emulation));
  }, [id, emulation]);
}

/** An open overlay, outside this frame, whose box intersects `r` (viewport px). */
function isCoveredAt(el: HTMLElement, r: { x: number; y: number; width: number; height: number }) {
  return [...document.querySelectorAll(OVERLAYS)].some((overlay) => {
    if (overlay.contains(el)) return false;
    const o = overlay.getBoundingClientRect();
    return o.width > 0 && o.height > 0 && o.left < r.x + r.width && o.right > r.x && o.top < r.y + r.height && o.bottom > r.y;
  });
}

export function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** The frame's CSS radius as a round corner: native views can't draw squircles, and a squircle at the scaled radius looks like a round one at radius / --corner-scale. */
function roundRadius(el: HTMLElement) {
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  const scale = CSS.supports('corner-shape', 'squircle') ? parseFloat(getComputedStyle(el).getPropertyValue('--corner-scale')) || 1 : 1;
  return radius / scale;
}
