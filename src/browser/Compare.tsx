import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { toast } from '@/toast/store';
import { Danger, X } from '@/icons';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { host } from '@/host';
import type { CompareBase } from '@/host/types/browser';
import type { Thread } from '@/model';
import { TooltipIconButton } from '../ui';
import { closeCompare, openCompare } from './actions';
import { PageSurface } from './PageSurface';
import { basePageKey, ensureView, updatePage, usePage, type CompareState, type Page } from './pages';
import { nextScrollSync, type ScrollPoint } from './scrollSync';
import { swapOrigin } from './url';

const SCROLL_SYNC_MS = 80;

/** The thread's page beside the same URL served from the base branch: live side by side, or captures under a slider. */
export function ComparePane({ thread, pageId, page, compare }: { thread: Thread; pageId: string; page: Page; compare: CompareState }) {
  const branch = thread.repo?.branch ?? 'this branch';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 px-2 type-caption text-muted-foreground">
        <ToggleGroup type="single" size="sm" variant="outline" spacing={1} value={compare.mode} disabled={compare.status !== 'ready'} onValueChange={(v) => v && updatePage(pageId, { compare: { ...compare, mode: v as CompareState['mode'] } })} aria-label="Compare layout">
          <ToggleGroupItem value="split">Side by side</ToggleGroupItem>
          <ToggleGroupItem value="slider">Slider</ToggleGroupItem>
        </ToggleGroup>
        <span className="min-w-0 flex-1 truncate">
          {compare.status === 'ready' && (compare.base.isReused ? `${compare.base.branch} from the dev server already running in the project folder` : `${compare.base.branch} served from a temporary worktree`)}
        </span>
        <TooltipIconButton label="Close compare" hint={compare.status === 'ready' && !compare.base.isReused ? 'Stops the base server and removes its worktree' : undefined} onClick={() => closeCompare(pageId, thread.id)}>
          <X />
        </TooltipIconButton>
      </div>
      <div className="min-h-0 flex-1">
        {compare.status === 'starting' && <CompareStarting />}
        {compare.status === 'error' && <CompareError message={compare.message} onRetry={() => openCompare(pageId, thread)} />}
        {compare.status === 'ready' && compare.mode === 'split' && <SideBySide thread={thread} pageId={pageId} page={page} base={compare.base} branch={branch} />}
        {compare.status === 'ready' && compare.mode === 'slider' && <SliderCompare thread={thread} pageId={pageId} page={page} base={compare.base} branch={branch} />}
      </div>
    </div>
  );
}

function SideBySide({ thread, pageId, page, base, branch }: { thread: Thread; pageId: string; page: Page; base: CompareBase; branch: string }) {
  const baseKey = basePageKey(pageId);
  const basePage = useBasePage(thread, pageId, page, base);
  useScrollSync(page.hostId, basePage.hostId);

  return (
    <div className="grid h-full grid-cols-2 gap-px bg-border">
      {[
        { key: baseKey, label: base.branch, page: basePage },
        { key: pageId, label: branch, page },
      ].map((side) => (
        <div key={side.key} className="flex min-h-0 min-w-0 flex-col bg-sidebar">
          <span className="truncate px-2 py-1 type-caption text-muted-foreground">{side.label}</span>
          <div className="min-h-0 flex-1">
            <PageSurface thread={thread} pageId={side.key} page={side.page} isDriving={false} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The base page follows the thread page's path; created on first use so the slider can capture it before it was ever shown. */
function useBasePage(thread: Thread, pageId: string, page: Page, base: CompareBase) {
  const baseKey = basePageKey(pageId);
  const url = swapOrigin(page.url, base.origin);
  const basePage = usePage(baseKey, url);
  // Only the thread page's navigation drives the base page; the base page's own redirects are left alone.
  const sent = useRef(url);
  useEffect(() => void ensureView(baseKey, thread.spaceId), [baseKey, thread.spaceId]);
  useEffect(() => {
    if (!basePage.hostId || sent.current === url) return;
    sent.current = url;
    updatePage(baseKey, { url });
    void host.browser.navigate(basePage.hostId, url);
  }, [url, basePage.hostId, baseKey]);
  return basePage;
}

/** Polls both pages and moves whichever didn't scroll: the native views report no scroll events to the app. */
function useScrollSync(a: string | null, b: string | null) {
  useEffect(() => {
    if (!a || !b) return;
    let last: ScrollPoint | null = null;
    let isBusy = false;
    const timer = setInterval(async () => {
      if (isBusy) return;
      isBusy = true;
      try {
        const [pa, pb] = await Promise.all([host.browser.scroll(a, null), host.browser.scroll(b, null)]);
        const step = nextScrollSync(last, pa, pb);
        last = step ? await host.browser.scroll(step.move === 'a' ? a : b, step.to) : pa;
      } catch {
        // A page mid-navigation has no document to read; the next tick catches up.
      } finally {
        isBusy = false;
      }
    }, SCROLL_SYNC_MS);
    return () => clearInterval(timer);
  }, [a, b]);
}

function SliderCompare({ thread, pageId, page, base, branch }: { thread: Thread; pageId: string; page: Page; base: CompareBase; branch: string }) {
  const basePage = useBasePage(thread, pageId, page, base);
  const [shots, setShots] = useState<{ base: string; head: string } | null>(null);
  const [split, setSplit] = useState(50);
  const [width, setWidth] = useState<number>();
  const boxRef = useRef<HTMLDivElement>(null);
  const isReady = !!page.hostId && !!basePage.hostId && !basePage.isLoading && !page.isLoading;

  useEffect(() => {
    if (!isReady || shots) return;
    Promise.all([host.browser.capture(basePage.hostId!, { fullPage: true }), host.browser.capture(page.hostId!, { fullPage: true })]).then(
      ([b, h]) => setShots({ base: b, head: h }),
      (error) => toast.error('Could not capture the pages', { description: String(error) }),
    );
  }, [isReady, shots, basePage.hostId, page.hostId]);

  const dragTo = (e: PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    setSplit(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') setSplit((s) => Math.max(0, s - step));
    if (e.key === 'ArrowRight') setSplit((s) => Math.min(100, s + step));
  };

  if (!shots) return <CompareStarting label="Capturing both pages…" />;
  // Shown at the CSS width the pages were laid out at, so the captures stay sharp and line up with the layout you saw.
  return (
    <div className="relative mx-auto h-full" style={{ maxWidth: width }}>
      <div className="h-full overflow-auto" style={{ scrollbarWidth: 'none' }}>
        <div ref={boxRef} className="relative">
          <img src={shots.head} alt={`${branch} page`} draggable={false} onLoad={(e) => setWidth(e.currentTarget.naturalWidth / devicePixelRatio)} className="block w-full select-none" />
          <img src={shots.base} alt={`${base.branch} page`} draggable={false} className="absolute inset-x-0 top-0 block w-full select-none" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
        </div>
      </div>
      {/* Outside the scroller so the handle stays in view while the captures scroll under it. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Base / thread split"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(split)}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragTo(e);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && dragTo(e)}
        className="group absolute inset-y-0 w-6 -translate-x-1/2 cursor-ew-resize touch-none outline-none"
        style={{ left: `${split}%` }}
      >
        {/* Fixed colours, not theme tokens: the line sits on the page's own pixels, light or dark. */}
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.45)]" />
        <span aria-hidden className="absolute top-1/2 left-1/2 size-5 -translate-1/2 rounded-full bg-popover shadow-float group-focus-visible:ring-2 group-focus-visible:ring-ring" />
      </div>
      <SliderLabel side="left">{base.branch}</SliderLabel>
      <SliderLabel side="right">{branch}</SliderLabel>
      <Button size="xs" variant="outline" className="absolute bottom-2 left-1/2 -translate-x-1/2 border-transparent bg-popover text-foreground shadow-popover dark:bg-popover" onClick={() => setShots(null)}>
        Capture again
      </Button>
    </div>
  );
}

function SliderLabel({ side, children }: { side: 'left' | 'right'; children: string }) {
  return <span className={`pointer-events-none absolute top-2 max-w-[40%] truncate rounded-full bg-popover px-2 py-0.5 type-caption text-foreground shadow-popover ${side === 'left' ? 'left-2' : 'right-2'}`}>{children}</span>;
}

function CompareStarting({ label = 'Starting the base branch…' }: { label?: string }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Spinner />
        </EmptyMedia>
        <EmptyTitle>{label}</EmptyTitle>
        <EmptyDescription>Checks the base branch out into a temporary worktree and runs the project's dev script, or reuses a server already running on it.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function CompareError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Danger />
        </EmptyMedia>
        <EmptyTitle>Couldn't serve the base branch</EmptyTitle>
        <EmptyDescription className="line-clamp-6 font-mono break-all whitespace-pre-wrap">{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  );
}
