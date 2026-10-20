import { Copy, Download, Expand, FolderOpen, ImageSparkle, WarningAlt } from '@/icons';
import { toast } from '@/toast/store';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { useRef, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { useElapsed } from '../agents/parts';
import { formatElapsed } from '../progress';
import { IS_MAC } from '../keys';
import type { GeneratedImage } from '../model';
import { isFilePath, revealFile, useImageUrls } from './imageSrc';
import { GeneratingDots } from './GeneratingDots';
import { copyImage, openPhotos, saveImage, type Photo } from '../photo/photos';
import { TooltipIconButton } from '../ui';

export const REVEAL_LABEL = IS_MAC ? 'Show in Finder' : 'Show in folder';

/**
 * One generated image: a frame at the target aspect where light drifts through a dot grid while it's made, then the image
 * opens out from where the light last pooled, its blur clearing, so the transcript never jumps. The prompt lies on the frame's
 * bottom edge, shimmering until the image lands; open, copy, download and reveal (for a file on disk) sit on the image.
 * `startedMs`: when generating began, for the elapsed time.
 */
export function ImageGenCard({ image, startedMs, className }: { image: GeneratedImage; startedMs?: number; className?: string }) {
  const { prompt, src } = image;
  const [url] = useImageUrls(src ? [src] : []);
  // A finished image whose file is gone reads as failed, saying so, rather than an empty frame.
  const status = image.status === 'done' && url === null ? 'failed' : image.status;
  const error = url === null ? 'The image file was moved or deleted.' : image.error;
  const onReveal = src && isFilePath(src) ? () => void revealFile(src) : undefined;
  // Only an image you watched being made lands with the reveal; one already done when the row mounts just shows.
  const hasWaited = useRef(false);
  if (status === 'running') hasWaited.current = true;
  const light = useRef({ x: 0.5, y: 0.5 });
  const landFrom = { '--land-x': `${light.current.x * 100}%`, '--land-y': `${light.current.y * 100}%` } as CSSProperties;
  const photo: Photo | null = status === 'done' && url ? { src: url, name: prompt?.slice(0, 60) ?? 'Generated image', ...(onReveal && { reveal: onReveal }) } : null;

  return (
    <figure style={{ aspectRatio: image.aspect ?? 1 }} className={cn('group/gen relative w-full max-w-sm overflow-hidden rounded-xl border bg-muted', className)}>
      {status === 'running' && <GeneratingDots onCentre={(x, y) => (light.current = { x, y })} />}
      {!!photo && (
        <button type="button" aria-label="Open image larger" onClick={() => openPhotos({ photos: [photo], index: 0 })} className="absolute inset-0 cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-2">
          <img src={photo.src} alt={prompt ?? ''} style={landFrom} className={cn('size-full object-cover', hasWaited.current && 'animate-image-land')} />
        </button>
      )}
      {status === 'failed' && <FailedFrame error={error} />}
      {/* Lies on the frame, never a strip under it: an eased fade into the frame's muted fill, or a dark scrim over the image. Clicks pass through to the image. */}
      <figcaption className={cn('pointer-events-none absolute inset-x-0 bottom-0 flex min-w-0 items-start gap-2 px-3 pt-14 pb-3', photo ? 'caption-scrim text-white' : 'caption-fade')}>
        <ImageSparkle aria-hidden className={cn('mt-0.5 size-3.5 shrink-0', photo ? 'text-white/80' : 'text-muted-foreground')} />
        {status === 'running' ? (
          <Shimmer as="span" className="line-clamp-2 min-w-0 flex-1 type-meta">
            {prompt ?? 'Generating image'}
          </Shimmer>
        ) : (
          <span className={cn('line-clamp-2 min-w-0 flex-1 type-meta', photo ? 'text-white/90' : 'text-muted-foreground')}>{prompt ?? 'Generated image'}</span>
        )}
        {status === 'running' && startedMs !== undefined && <Elapsed startedMs={startedMs} />}
      </figcaption>
      {!!photo && <ImageActions photo={photo} onReveal={onReveal} />}
    </figure>
  );
}

// Its own component, so the second's tick re-renders only the number.
function Elapsed({ startedMs }: { startedMs: number }) {
  return <span className="shrink-0 type-caption leading-5 text-subtle-foreground tabular">{formatElapsed(useElapsed(startedMs))}</span>;
}

function FailedFrame({ error }: { error?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-muted px-6 text-center">
      <WarningAlt aria-hidden className="size-5 text-warning" />
      <span className="type-meta text-foreground">Couldn’t generate the image</span>
      {!!error && <span className="type-caption text-muted-foreground">{error}</span>}
    </div>
  );
}

function ImageActions({ photo, onReveal }: { photo: Photo; onReveal?: () => void }) {
  return (
    // Opaque, so the image never shows through; always shown where nothing can hover.
    <span className="absolute top-2 right-2 flex items-center rounded-lg bg-popover p-0.5 shadow-float transition-opacity duration-150 pointer-fine:opacity-0 pointer-fine:group-focus-within/gen:opacity-100 pointer-fine:group-hover/gen:opacity-100 [&_svg]:size-3.5">
      <TooltipIconButton label="Open larger" hint="Zoom and pan in the viewer" onClick={() => openPhotos({ photos: [photo], index: 0 })}>
        <Expand />
      </TooltipIconButton>
      <TooltipIconButton label="Copy image" onClick={() => copyImage(photo).then(() => toast('Image copied'), () => toast.error('Could not copy this image'))}>
        <Copy />
      </TooltipIconButton>
      <TooltipIconButton label="Download" onClick={() => saveImage(photo)}>
        <Download />
      </TooltipIconButton>
      {!!onReveal && (
        <TooltipIconButton label={REVEAL_LABEL} hint="Where the agent saved it" onClick={onReveal}>
          <FolderOpen />
        </TooltipIconButton>
      )}
    </span>
  );
}
