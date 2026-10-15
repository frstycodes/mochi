import { useState } from 'react';
import { GallerySlash } from 'reicon-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { openPhotos, type Photo } from '../photo/photos';

const SHOWN = 4;

// The 8% inside outline every chat image gets, so a white screenshot still has an edge on a light page.
export const IMAGE_OUTLINE = 'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] dark:after:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]';

type Layout = 'single' | 'pair' | 'row';

/** Images in a message: one keeps its shape, two sit side by side as squares, more become a row of small squares with the rest counted on the last. Each opens the viewer on the whole set. */
export function MessageImages({ photos, className }: { photos: Photo[]; className?: string }) {
  const layout: Layout = photos.length === 1 ? 'single' : photos.length === 2 ? 'pair' : 'row';
  const shown = photos.slice(0, SHOWN);
  const hidden = photos.length - shown.length;
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {shown.map((photo, i) => (
        <ImageTile key={`${i}:${photo.src}`} photo={photo} layout={layout} more={i === shown.length - 1 ? hidden : 0} onOpen={() => openPhotos({ photos, index: i })} />
      ))}
    </div>
  );
}

const TILE = {
  single: 'max-h-60 max-w-[min(100%,20rem)]',
  pair: 'size-40',
  row: 'size-20',
} as const satisfies Record<Layout, string>;

function ImageTile({ photo, layout, more, onOpen }: { photo: Photo; layout: Layout; more: number; onOpen: () => void }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'broken'>('loading');
  if (status === 'broken') return <BrokenImage name={photo.name} layout={layout} />;

  const isSingle = layout === 'single';
  return (
    <button
      type="button"
      aria-label={more > 0 ? `View ${photo.name} and ${more} more` : `View ${photo.name}`}
      onClick={onOpen}
      className={cn('relative shrink-0 cursor-zoom-in overflow-hidden rounded-lg bg-muted focus-visible:outline-2 focus-visible:outline-offset-2', IMAGE_OUTLINE, TILE[layout])}
    >
      {status === 'loading' && <Skeleton className={cn('rounded-none', isSingle ? 'h-40 w-60' : 'absolute inset-0')} />}
      <img
        src={photo.src}
        alt=""
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('broken')}
        className={cn(isSingle ? 'block max-h-60 w-auto max-w-full' : 'size-full object-cover', status === 'loading' && 'absolute size-0 opacity-0')}
      />
      {more > 0 && <span className="absolute inset-0 grid place-items-center bg-black/55 type-title text-white tabular">+{more}</span>}
    </button>
  );
}

function BrokenImage({ name, layout }: { name: string; layout: Layout }) {
  if (layout !== 'single')
    return (
      <span role="img" aria-label={`${name}, not available`} title={`${name} is not available`} className={cn('grid shrink-0 place-items-center rounded-lg bg-muted text-subtle-foreground', TILE[layout])}>
        <GallerySlash aria-hidden className="size-4" />
      </span>
    );
  return (
    <span className="flex h-9 max-w-full items-center gap-2 rounded-lg bg-muted px-3 type-meta text-muted-foreground">
      <GallerySlash aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
      <span className="truncate">{name}</span>
      <span className="shrink-0 text-subtle-foreground">not available</span>
    </span>
  );
}
