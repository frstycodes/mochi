import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Danger } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { host } from '@/host';
import { cn } from '@/lib/utils';
import type { Thread } from '@/model';
import { pickDemoElement } from './actions';
import { DemoPage } from './DemoPage';
import { DEVICES, fitDevice } from './devices';
import { emulationOf, ensureView, type Page } from './pages';

// Open overlays the native view would paint over. Tooltips are left out: they'd blink the page on every hover.
const OVERLAYS = '[role=dialog], [role=menu], [role=listbox], [data-slot=popover-content], [data-slot=hover-card-content]';

/** The page itself: a native view placed over this box on desktop, an iframe (or the demo page) on the web. */
export function PageSurface({ thread, pageId, page, isDriving, className }: { thread: Thread; pageId: string; page: Page; isDriving: boolean; className?: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const size = useSize(frameRef);
  const device = deviceSize(page);
  const fit = device && size.w > 0 ? fitDevice({ width: size.w, height: size.h }, device, page.isRotated) : null;
  useNativeView(frameRef, page, device);
  useEmulation(page, fit);
  useEffect(() => void ensureView(pageId, thread.spaceId), [pageId, thread.spaceId]);

  return (
    <div ref={frameRef} className={cn('relative h-full overflow-hidden rounded-xl bg-background ring-1 ring-border', isDriving && 'ring-2 ring-foreground/25', !!device && 'bg-muted/40', className)}>
      {page.error && <PageError error={page.error} onRetry={() => page.hostId && host.browser.command(page.hostId, 'reload')} />}
      {!host.isDesktop && size.w > 0 && (
        <div
          className={cn('absolute origin-top-left overflow-hidden', fit && 'rounded-lg shadow-popover')}
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
 * PiP drag, sidebar slide) and never a frame stale. Hidden while unmounted, errored, or under an open overlay.
 */
function useNativeView(frameRef: RefObject<HTMLDivElement | null>, page: Page, device: { width: number; height: number } | null) {
  const params = useRef({ page, device });
  params.current = { page, device };
  const id = page.hostId;

  useEffect(() => {
    if (!id) return;
    let last = '';
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const el = frameRef.current;
      if (!el) return;
      const { page, device } = params.current;
      const r = el.getBoundingClientRect();
      const isHidden = !!page.error || r.width < 1 || r.height < 1 || isCovered(el);
      const fit = device ? fitDevice({ width: r.width, height: r.height }, device, page.isRotated) : null;
      const bounds = isHidden ? null : fit ? { x: r.x + fit.x, y: r.y + fit.y, width: fit.width, height: fit.height } : { x: r.x, y: r.y, width: r.width, height: r.height };
      const zoom = page.zoom;
      const next = JSON.stringify([bounds, zoom]);
      if (next === last) return;
      last = next;
      void host.browser.setBounds(id, bounds);
      void host.browser.setZoom(id, zoom);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      void host.browser.setBounds(id, null).catch(() => {});
    };
  }, [id, frameRef]);
}

function useEmulation(page: Page, fit: ReturnType<typeof fitDevice> | null) {
  const emulation = JSON.stringify(emulationOf(page, fit));
  const id = page.hostId;
  useEffect(() => {
    if (id) void host.browser.emulate(id, JSON.parse(emulation));
  }, [id, emulation]);
}

function isCovered(el: HTMLElement) {
  return [...document.querySelectorAll(OVERLAYS)].some((overlay) => !overlay.contains(el));
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
