import { listenKeydown, isCommand } from '../keymap';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FolderOpen,
  ImageOff,
  Maximize,
  Play,
  ZoomIn,
  ZoomOut,
  X,
} from '@/icons';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { REVEAL_LABEL } from '../chat/ImageGenCard';
import { useImageUrls } from '../chat/imageSrc';
import { ThreadOriginContext } from '../remote/origin';
import { VizThreadProvider } from '../viz/WidgetVisual';
import { BoundShortcut } from '../Shortcut';
import { TooltipIconButton } from '../ui';
import {
  copyImage,
  openPhotos,
  saveImage,
  usePhotoRequest,
  type Photo,
  type PhotoRequest,
} from './photos';
import { FIT, clampPan, isBackdropClick, zoomAt, type View } from './zoom';

const STEP = 1.5;
// Thumbnails each side of the current one: a thread can hold hundreds, and each one reads its file.
const FILMSTRIP_REACH = 8;

/** Full-window viewer for chat images and videos and composer attachments. Mounted once; `openPhotos` drives it. */
export function PhotoViewer() {
  const request = usePhotoRequest();
  const [index, setIndex] = useState(0);
  const [indexedRequest, setIndexedRequest] = useState(request);
  if (request !== indexedRequest) {
    setIndexedRequest(request);
    setIndex(request?.index ?? 0);
  }
  const photos = request?.photos ?? [];
  const photo = photos[index];
  const go = (step: number) =>
    photos.length > 1 &&
    setIndex((i) => (i + step + photos.length) % photos.length);
  const img = useRef<HTMLImageElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const press = useRef({ x: 0, y: 0 });

  return (
    <DialogPrimitive.Root
      open={!!photo}
      onOpenChange={(open) => !open && openPhotos(null)}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-background/50 backdrop-blur-sm duration-200 ease-(--ease-out) data-closed:duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none" />
        <DialogPrimitive.Popup
          ref={popup}
          // The default would focus the first toolbar button, opening its tooltip, which then takes the first Escape.
          initialFocus={popup}
          onKeyDown={(e) => {
            // A focused video's arrows seek it.
            if (e.target instanceof HTMLVideoElement) return;
            if (e.key === 'ArrowLeft') go(-1);
            if (e.key === 'ArrowRight') go(1);
          }}
          onPointerDown={(e) =>
            (press.current = { x: e.clientX, y: e.clientY })
          }
          // While zoomed the stage holds pointer capture, so a click on the image lands on the stage: test the point, not the target.
          onClick={(e) =>
            !(e.target as Element).closest('button, a, input, video') &&
            isBackdropClick(
              { x: e.clientX, y: e.clientY },
              press.current,
              img.current?.getBoundingClientRect(),
            ) &&
            openPhotos(null)
          }
          className="fixed inset-0 z-50 flex flex-col outline-none duration-200 ease-(--ease-out) data-closed:duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none"
        >
          <SourceScope thread={request?.thread}>
            {!!photo && (
              <Stage
                key={photo.src}
                img={img}
                photo={photo}
                onStep={photos.length > 1 ? go : undefined}
              />
            )}
            {photos.length > 1 && (
              <>
                <Filmstrip photos={photos} index={index} onSelect={setIndex} />
                <p className="shrink-0 pb-3 text-center type-caption text-subtle-foreground tabular">
                  {index + 1} / {photos.length}
                </p>
              </>
            )}
          </SourceScope>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Paths read on the computer the thread runs on, as its chat reads them. */
function SourceScope({
  thread,
  children,
}: {
  thread: PhotoRequest['thread'];
  children: ReactNode;
}) {
  if (!thread) return children;
  return (
    <ThreadOriginContext.Provider value={thread.origin}>
      <VizThreadProvider value={thread.id}>{children}</VizThreadProvider>
    </ThreadOriginContext.Provider>
  );
}

/** One photo or video: a photo is fitted by default; pinch or Ctrl-scroll and double-click zoom at the pointer, drag or scroll pans while zoomed. Keyed by src, so a new photo starts fitted. */
function Stage({
  img,
  photo,
  onStep,
}: {
  img: RefObject<HTMLImageElement | null>;
  photo: Photo;
  onStep?: (step: number) => void;
}) {
  const [url] = useImageUrls([photo.src]);
  const shown = url ? { ...photo, src: url } : null;
  const isVideo = photo.kind === 'video';
  const area = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

  const measure = () => {
    const a = area.current!.getBoundingClientRect();
    return {
      viewport: { width: a.width, height: a.height },
      fitted: {
        width: img.current!.offsetWidth,
        height: img.current!.offsetHeight,
      },
      centre: { x: a.left + a.width / 2, y: a.top + a.height / 2 },
    };
  };
  const zoom = (factor: number, clientX?: number, clientY?: number) =>
    !!img.current &&
    setView((v) => {
      const { viewport, fitted, centre } = measure();
      const at =
        clientX === undefined
          ? { x: 0, y: 0 }
          : { x: clientX - centre.x, y: clientY! - centre.y };
      return zoomAt(v, factor, at, fitted, viewport);
    });

  useZoomKeys(zoom, () => setView(FIT));
  useLayoutEffect(() => {
    // Ctrl-scroll and trackpad pinch must not zoom the whole page, so this listener can't be passive.
    const el = area.current!;
    const block = (e: WheelEvent) => e.ctrlKey && e.preventDefault();
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, []);

  const onWheel = (e: ReactWheelEvent) => {
    if (!img.current) return;
    if (e.ctrlKey)
      return zoom(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    if (view.scale === 1) return;
    const { viewport, fitted } = measure();
    setView(
      clampPan(
        { ...view, x: view.x - e.deltaX, y: view.y - e.deltaY },
        fitted,
        viewport,
      ),
    );
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    if (view.scale === 1 || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, view };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { viewport, fitted } = measure();
    setView(
      clampPan(
        {
          ...d.view,
          x: d.view.x + e.clientX - d.x,
          y: d.view.y + e.clientY - d.y,
        },
        fitted,
        viewport,
      ),
    );
  };
  const isZoomed = view.scale > 1;

  return (
    <>
      {/* Fills the window, so it always sits under Windows' caption buttons. Not a drag region: those swallow clicks, and a click on its empty space closes the viewer. */}
      <header
        data-under-captions
        className="flex h-11 shrink-0 items-center gap-1 px-3 in-data-traffic-lights:pl-20"
      >
        <DialogPrimitive.Title className="min-w-0 truncate px-1 type-title">
          {photo.name}
        </DialogPrimitive.Title>
        <span className="flex-1" />
        {!isVideo && (
          <ZoomControls
            scale={view.scale}
            isReady={!!shown}
            onZoom={zoom}
            onFit={() => setView(FIT)}
          />
        )}
        {!!shown && !isVideo && (
          <TooltipIconButton
            label="Copy image"
            onClick={() =>
              copyImage(shown).then(
                () => toast('Image copied'),
                () => toast.error('Could not copy this image'),
              )
            }
          >
            <Copy />
          </TooltipIconButton>
        )}
        {!!shown && (
          <TooltipIconButton label="Download" onClick={() => saveImage(shown)}>
            <Download />
          </TooltipIconButton>
        )}
        {!!photo.reveal && (
          <TooltipIconButton label={REVEAL_LABEL} onClick={photo.reveal}>
            <FolderOpen />
          </TooltipIconButton>
        )}
        <DialogPrimitive.Close
          render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}
        >
          <X />
        </DialogPrimitive.Close>
      </header>
      <div
        ref={area}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={(e) =>
          e.target === img.current &&
          (isZoomed ? setView(FIT) : zoom(2.5, e.clientX, e.clientY))
        }
        className={cn(
          'relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden px-16 pb-4 select-none',
          isZoomed && 'cursor-grab active:cursor-grabbing',
        )}
      >
        {isVideo && !!shown && (
          // Autoplay muted is what Chromium allows without a gesture on the page; the controls unmute it.
          <video
            src={shown.src}
            aria-label={photo.name}
            controls
            autoPlay
            muted
            playsInline
            className="max-h-full max-w-full rounded-lg shadow-float"
          />
        )}
        {!isVideo && !!shown && (
          <img
            ref={img}
            src={shown.src}
            alt={photo.name}
            draggable={false}
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
            className={cn(
              'max-h-full max-w-full rounded-lg object-contain shadow-float',
              !isZoomed && 'cursor-zoom-in',
            )}
          />
        )}
        {url === undefined && (
          <Skeleton className="aspect-[3/2] w-[min(36rem,100%)] rounded-lg" />
        )}
        {url === null && <Unavailable name={photo.name} />}
        {!!onStep && (
          <>
            <StepButton side="left" onClick={() => onStep(-1)} />
            <StepButton side="right" onClick={() => onStep(1)} />
          </>
        )}
      </div>
    </>
  );
}

function ZoomControls({
  scale,
  isReady,
  onZoom,
  onFit,
}: {
  scale: number;
  isReady: boolean;
  onZoom: (factor: number) => void;
  onFit: () => void;
}) {
  const isZoomed = scale > 1;
  return (
    <>
      <TooltipIconButton
        label="Zoom out"
        hint={<BoundShortcut command="photo-zoom-out" />}
        disabled={!isZoomed}
        onClick={() => onZoom(1 / STEP)}
      >
        <ZoomOut />
      </TooltipIconButton>
      <span className="w-11 text-center type-meta text-muted-foreground tabular">
        {Math.round(scale * 100)}%
      </span>
      <TooltipIconButton
        label="Zoom in"
        hint={<BoundShortcut command="photo-zoom-in" />}
        disabled={!isReady}
        onClick={() => onZoom(STEP)}
      >
        <ZoomIn />
      </TooltipIconButton>
      <TooltipIconButton
        label="Fit to window"
        hint={<BoundShortcut command="photo-fit" />}
        disabled={!isZoomed}
        onClick={onFit}
      >
        <Maximize />
      </TooltipIconButton>
    </>
  );
}

function Unavailable({ name }: { name: string }) {
  return (
    <p className="flex flex-col items-center gap-2 type-meta text-muted-foreground">
      <ImageOff aria-hidden className="size-6 text-subtle-foreground" />
      {name} is not available
    </p>
  );
}

function useZoomKeys(zoom: (factor: number) => void, fit: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isCommand(e, 'photo-zoom-in') || isCommand(e, 'photo-zoom-in-shift'))
        zoom(STEP);
      if (isCommand(e, 'photo-zoom-out')) zoom(1 / STEP);
      if (isCommand(e, 'photo-fit')) fit();
    };
    return listenKeydown(onKey);
  }, [zoom, fit]);
}

function StepButton({
  side,
  onClick,
}: {
  side: 'left' | 'right';
  onClick: () => void;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <Button
      variant="secondary"
      size="icon"
      aria-label={side === 'left' ? 'Previous image' : 'Next image'}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 rounded-full shadow-popover',
        side === 'left' ? 'left-4' : 'right-4',
      )}
    >
      <Icon />
    </Button>
  );
}

function Filmstrip({
  photos,
  index,
  onSelect,
}: {
  photos: Photo[];
  index: number;
  onSelect: (i: number) => void;
}) {
  const start = Math.max(0, index - FILMSTRIP_REACH);
  const shown = photos.slice(start, index + FILMSTRIP_REACH + 1);
  return (
    <nav
      aria-label="Images"
      className="flex shrink-0 justify-center gap-2 overflow-hidden px-4 pt-1 pb-2"
    >
      {shown.map((p, j) => (
        <Thumb
          key={`${start + j}:${p.src}`}
          photo={p}
          isCurrent={start + j === index}
          onSelect={() => onSelect(start + j)}
        />
      ))}
    </nav>
  );
}

function Thumb({
  photo,
  isCurrent,
  onSelect,
}: {
  photo: Photo;
  isCurrent: boolean;
  onSelect: () => void;
}) {
  const [url] = useImageUrls([photo.src]);
  return (
    <button
      type="button"
      aria-label={photo.name}
      aria-current={isCurrent || undefined}
      onClick={onSelect}
      className={cn(
        'relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted text-subtle-foreground transition-opacity *:col-start-1 *:row-start-1',
        isCurrent
          ? 'border-foreground/40 opacity-100'
          : 'border-transparent opacity-50 hover:opacity-80',
      )}
    >
      {!!url && photo.kind === 'video' && (
        <>
          <video
            src={url}
            muted
            preload="metadata"
            className="size-full object-cover"
          />
          <Play aria-hidden className="size-4 text-white drop-shadow" />
        </>
      )}
      {!!url && photo.kind !== 'video' && (
        <img src={url} alt="" className="size-full object-cover" />
      )}
      {url === null && <ImageOff aria-hidden className="size-4" />}
    </button>
  );
}
