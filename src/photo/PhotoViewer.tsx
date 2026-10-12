import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { ChevronLeft, ChevronRight, Copy, Download, Maximize, SearchZoomIn, SearchZoomOut, X, type IconComponent } from 'reicon-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { copyImage, openPhotos, saveImage, usePhotoRequest, type Photo } from './photos';
import { FIT, clampPan, zoomAt, type View } from './zoom';

const STEP = 1.5;

/** Full-window viewer for chat images and composer attachments. Mounted once; `openPhotos` drives it. */
export function PhotoViewer() {
  const request = usePhotoRequest();
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(request?.index ?? 0), [request]);
  const photos = request?.photos ?? [];
  const photo = photos[index];
  const go = (step: number) => photos.length > 1 && setIndex((i) => (i + step + photos.length) % photos.length);

  return (
    <DialogPrimitive.Root open={!!photo} onOpenChange={(open) => !open && openPhotos(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/90 backdrop-blur-xl data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') go(-1);
            if (e.key === 'ArrowRight') go(1);
          }}
          className="fixed inset-0 z-50 flex flex-col outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none"
        >
          {!!photo && <Stage key={photo.src} photo={photo} position={photos.length > 1 ? `${index + 1} of ${photos.length}` : undefined} onStep={photos.length > 1 ? go : undefined} />}
          {photos.length > 1 && <Filmstrip photos={photos} index={index} onSelect={setIndex} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** One photo: fitted by default; pinch or Ctrl-scroll and double-click zoom at the pointer, drag or scroll pans while zoomed. Keyed by src, so a new photo starts fitted. */
function Stage({ photo, position, onStep }: { photo: Photo; position?: string; onStep?: (step: number) => void }) {
  const area = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<View>(FIT);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

  const measure = () => {
    const a = area.current!.getBoundingClientRect();
    return { viewport: { width: a.width, height: a.height }, fitted: { width: img.current!.offsetWidth, height: img.current!.offsetHeight }, centre: { x: a.left + a.width / 2, y: a.top + a.height / 2 } };
  };
  const zoom = (factor: number, clientX?: number, clientY?: number) =>
    setView((v) => {
      const { viewport, fitted, centre } = measure();
      const at = clientX === undefined ? { x: 0, y: 0 } : { x: clientX - centre.x, y: clientY! - centre.y };
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
    if (e.ctrlKey) return zoom(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    if (view.scale === 1) return;
    const { viewport, fitted } = measure();
    setView(clampPan({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY }, fitted, viewport));
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
    setView(clampPan({ ...d.view, x: d.view.x + e.clientX - d.x, y: d.view.y + e.clientY - d.y }, fitted, viewport));
  };
  const isZoomed = view.scale > 1;

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-1 px-3">
        <DialogPrimitive.Title className="min-w-0 truncate px-1 type-title">{photo.name}</DialogPrimitive.Title>
        {!!position && <span className="shrink-0 px-1 type-meta text-subtle-foreground tabular">{position}</span>}
        <span className="flex-1" />
        <ToolButton label="Zoom out" keys="−" icon={SearchZoomOut} disabled={!isZoomed} onClick={() => zoom(1 / STEP)} />
        <span className="w-11 text-center type-meta text-muted-foreground tabular">{Math.round(view.scale * 100)}%</span>
        <ToolButton label="Zoom in" keys="+" icon={SearchZoomIn} onClick={() => zoom(STEP)} />
        <ToolButton label="Fit to window" keys="0" icon={Maximize} disabled={!isZoomed} onClick={() => setView(FIT)} />
        <ToolButton label="Copy image" icon={Copy} onClick={() => copyImage(photo).then(() => toast('Image copied'), () => toast.error('Could not copy this image'))} />
        <ToolButton label="Download" icon={Download} onClick={() => saveImage(photo)} />
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Close">
            <X />
          </Button>
        </DialogPrimitive.Close>
      </header>
      <div
        ref={area}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={(e) => (isZoomed ? setView(FIT) : zoom(2.5, e.clientX, e.clientY))}
        className={cn('relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden px-16 pb-4 select-none', isZoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in')}
      >
        <img
          ref={img}
          src={photo.src}
          alt={photo.name}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          className="max-h-full max-w-full rounded-lg object-contain shadow-float"
        />
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

function useZoomKeys(zoom: (factor: number) => void, fit: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') zoom(STEP);
      if (e.key === '-') zoom(1 / STEP);
      if (e.key === '0') fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom, fit]);
}

function ToolButton({ label, keys, icon: Icon, ...props }: { label: string; keys?: string; icon: IconComponent } & Omit<React.ComponentProps<typeof Button>, 'children'>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} {...props}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {!!keys && <Kbd className="ml-1.5">{keys}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

function StepButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <Button
      variant="secondary"
      size="icon"
      aria-label={side === 'left' ? 'Previous image' : 'Next image'}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn('absolute top-1/2 -translate-y-1/2 rounded-full shadow-popover', side === 'left' ? 'left-4' : 'right-4')}
    >
      <Icon />
    </Button>
  );
}

function Filmstrip({ photos, index, onSelect }: { photos: Photo[]; index: number; onSelect: (i: number) => void }) {
  return (
    <nav aria-label="Images" className="flex shrink-0 justify-center gap-2 overflow-x-auto px-4 pt-1 pb-4">
      {photos.map((p, i) => (
        <button
          key={`${p.src}:${i}`}
          type="button"
          aria-label={p.name}
          aria-current={i === index || undefined}
          onClick={() => onSelect(i)}
          className={cn('size-12 shrink-0 overflow-hidden rounded-md border transition-opacity', i === index ? 'border-foreground/40 opacity-100' : 'border-transparent opacity-50 hover:opacity-80')}
        >
          <img src={p.src} alt="" className="size-full object-cover" />
        </button>
      ))}
    </nav>
  );
}
