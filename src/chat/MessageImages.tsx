import { useState } from 'react';
import { ImageOff } from '@/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { openPhotos, type Photo } from '../photo/photos';
import { isFilePath, revealFile, useImageUrls } from './imageSrc';

const SHOWN = 4;

// The 8% inside outline every chat image gets, so a white screenshot still has an edge on a light page.
export const IMAGE_OUTLINE =
  'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] dark:after:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]';

export type Layout = 'single' | 'pair' | 'row';

/**
 * Images in a message: one keeps its shape, two sit side by side as squares, more become a row of small squares with the
 * rest counted on the last. A `src` may be a file path (read through the file host). Each opens the viewer on the set.
 */
export function MessageImages({ photos, className }: { photos: Photo[]; className?: string }) {
  const urls = useImageUrls(photos.map((p) => p.src));
  const layout: Layout = photos.length === 1 ? 'single' : photos.length === 2 ? 'pair' : 'row';
  const shown = photos.slice(0, SHOWN);
  const hidden = photos.length - shown.length;
  // Images that couldn't be read stay out of the viewer; the index counts only the ones before `i` that it shows.
  const open = (i: number) => {
    const viewable = photos.flatMap((p, j) => (urls[j] ? [{ ...p, src: urls[j]!, ...(isFilePath(p.src) && { reveal: () => void revealFile(p.src) }) }] : []));
    openPhotos({ photos: viewable, index: urls.slice(0, i).filter(Boolean).length });
  };
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {shown.map((photo, i) => (
        <ImageTile
          key={`${i}:${photo.src}`}
          name={photo.name}
          url={urls[i]}
          layout={layout}
          more={i === shown.length - 1 ? hidden : 0}
          onOpen={() => open(i)}
        />
      ))}
    </div>
  );
}

const TILE = {
  single: 'max-h-60 max-w-[min(100%,20rem)]',
  pair: 'size-40',
  row: 'size-20',
} as const satisfies Record<Layout, string>;

/** `url`: `undefined` while a file is still being read, `null` when it couldn't be. */
function ImageTile({ name, url, layout, more, onOpen }: { name: string; url: string | null | undefined; layout: Layout; more: number; onOpen: () => void }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'broken'>('loading');
  if (status === 'broken' || url === null) return <BrokenImage name={name} layout={layout} />;

  const isSingle = layout === 'single';
  return (
    <button
      type="button"
      aria-label={more > 0 ? `View ${name} and ${more} more` : `View ${name}`}
      onClick={onOpen}
      className={cn(
        'relative shrink-0 cursor-zoom-in overflow-hidden rounded-lg bg-muted focus-visible:outline-2 focus-visible:outline-offset-2',
        IMAGE_OUTLINE,
        TILE[layout],
      )}
    >
      {status === 'loading' && <Skeleton className={cn('rounded-none', isSingle ? 'h-40 w-60' : 'absolute inset-0')} />}
      {!!url && (
        <img
          src={url}
          alt=""
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('broken')}
          className={cn(isSingle ? 'block max-h-60 w-auto max-w-full' : 'size-full object-cover', status === 'loading' && 'absolute size-0 opacity-0')}
        />
      )}
      {more > 0 && <span className="absolute inset-0 grid place-items-center bg-black/55 type-title text-white tabular">+{more}</span>}
    </button>
  );
}

export function BrokenImage({ name, layout }: { name: string; layout: Layout }) {
  if (layout !== 'single')
    return (
      <span
        role="img"
        aria-label={`${name}, not available`}
        title={`${name} is not available`}
        className={cn('grid shrink-0 place-items-center rounded-lg bg-muted text-subtle-foreground', TILE[layout])}
      >
        <ImageOff aria-hidden className="size-4" />
      </span>
    );
  return (
    <span className="flex h-9 max-w-full items-center gap-2 rounded-lg bg-muted px-3 type-meta text-muted-foreground">
      <ImageOff aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
      <span className="truncate">{name}</span>
      <span className="shrink-0 text-subtle-foreground">not available</span>
    </span>
  );
}
