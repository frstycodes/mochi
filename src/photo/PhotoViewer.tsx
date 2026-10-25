import { listenKeydown, isCommand } from '../keymap';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent as ReactWheelEvent } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { ChevronLeft, ChevronRight, Copy, Download, FolderOpen, Maximize, ZoomIn, ZoomOut, X } from '@/icons';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { REVEAL_LABEL } from '../chat/ImageGenCard';
import { BoundShortcut } from '../Shortcut';
import { TooltipIconButton } from '../ui';
import { copyImage, openPhotos, saveImage, usePhotoRequest, type Photo } from './photos';
import { FIT, clampPan, isBackdropClick, zoomAt, type View } from './zoom';

const STEP = 1.5;

/** Full-window viewer for chat images and composer attachments. Mounted once; `openPhotos` drives it. */
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
  const go = (step: number) => photos.length > 1 && setIndex((i) => (i + step + photos.length) % photos.length);
  const img = useRef<HTMLImageElement>(null);
  const press = useRef({ x: 0, y: 0 });

  return (
    <DialogPrimitive.Root open={!!photo} onOpenChange={(open) => !open && openPhotos(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/50 backdrop-blur-sm duration-200 ease-(--ease-out) data-[state=closed]:duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Radix would focus the first toolbar button, opening its tooltip, which then takes the first Escape.
          onOpenAutoFocus={(e) => (e.preventDefault(), (e.currentTarget as HTMLElement).focus())}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') go(-1);
            if (e.key === 'ArrowRight') go(1);
          }}
          onPointerDown={(e) => (press.current = { x: e.clientX, y: e.clientY })}
          // While zoomed the stage holds pointer capture, so a click on the image lands on the stage: test the point, not the target.
          onClick={(e) => !(e.target as Element).closest('button, a, input') && isBackdropClick({ x: e.clientX, y: e.clientY }, press.current, img.current?.getBoundingClientRect()) && openPhotos(null)}
          className="fixed inset-0 z-50 flex flex-col outline-none duration-200 ease-(--ease-out) data-[state=closed]:duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none"
        >
          {!!photo && <Stage key={photo.src} img={img} photo={photo} position={photos.length > 1 ? `${index + 1} of ${photos.length}` : undefined} onStep={photos.length > 1 ? go : undefined} />}
          {photos.length > 1 && <Filmstrip photos={photos} index={index} onSelect={setIndex} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** One photo: fitted by default; pinch or Ctrl-scroll and double-click zoom at the pointer, drag or scroll pans while zoomed. Keyed by src, so a new photo starts fitted. */
function Stage({ img, photo, position, onStep }: { img: RefObject<HTMLImageElement | null>; photo: Photo; position?: string; onStep?: (step: number) => void }) {
  const area = useRef<HTMLDivElement>(null);
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
      {/* Fills the window, so it always sits under Windows' caption buttons. Not a drag region: those swallow clicks, and a click on its empty space closes the viewer. */}
      <header data-under-captions className="flex h-11 shrink-0 items-center gap-1 px-3 in-data-traffic-lights:pl-20">
        <DialogPrimitive.Title className="min-w-0 truncate px-1 type-title">{photo.name}</DialogPrimitive.Title>
        {!!position && <span className="shrink-0 px-1 type-meta text-subtle-foreground tabular">{position}</span>}
        <span className="flex-1" />
        <TooltipIconButton label="Zoom out" hint={<BoundShortcut command="photo-zoom-out" />} disabled={!isZoomed} onClick={() => zoom(1 / STEP)}>
          <ZoomOut />
        </TooltipIconButton>
        <span className="w-11 text-center type-meta text-muted-foreground tabular">{Math.round(view.scale * 100)}%</span>
        <TooltipIconButton label="Zoom in" hint={<BoundShortcut command="photo-zoom-in" />} onClick={() => zoom(STEP)}>
          <ZoomIn />
        </TooltipIconButton>
        <TooltipIconButton label="Fit to window" hint={<BoundShortcut command="photo-fit" />} disabled={!isZoomed} onClick={() => setView(FIT)}>
          <Maximize />
        </TooltipIconButton>
        <TooltipIconButton label="Copy image" onClick={() => copyImage(photo).then(() => toast('Image copied'), () => toast.error('Could not copy this image'))}>
          <Copy />
        </TooltipIconButton>
        <TooltipIconButton label="Download" onClick={() => saveImage(photo)}>
          <Download />
        </TooltipIconButton>
        {!!photo.reveal && (
          <TooltipIconButton label={REVEAL_LABEL} onClick={photo.reveal}>
            <FolderOpen />
          </TooltipIconButton>
        )}
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
        onDoubleClick={(e) => e.target === img.current && (isZoomed ? setView(FIT) : zoom(2.5, e.clientX, e.clientY))}
        className={cn('relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden px-16 pb-4 select-none', isZoomed && 'cursor-grab active:cursor-grabbing')}
      >
        <img
          ref={img}
          src={photo.src}
          alt={photo.name}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          className={cn('max-h-full max-w-full rounded-lg object-contain shadow-float', !isZoomed && 'cursor-zoom-in')}
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
      if (e.defaultPrevented) return;
      if (isCommand(e, 'photo-zoom-in') || isCommand(e, 'photo-zoom-in-shift')) zoom(STEP);
      if (isCommand(e, 'photo-zoom-out')) zoom(1 / STEP);
      if (isCommand(e, 'photo-fit')) fit();
    };
    return listenKeydown(onKey);
  }, [zoom, fit]);
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
