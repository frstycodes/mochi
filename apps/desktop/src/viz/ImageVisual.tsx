import {
  useState,
  type ComponentProps,
  type DragEvent,
  type ReactNode,
} from 'react';
import { Play } from '@/icons';
import { toast } from '@/toast/store';
import type { ExtraProps } from 'streamdown';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { threadPath, isVideo } from '../photo/gallery';
import { fetchImage, imageFileName, useOpenInThread } from '../photo/photos';
import { useImageUrls } from '../chat/imageSrc';
import { BrokenImage, IMAGE_OUTLINE } from '../chat/MessageImages';
import { useThreadFiles } from '../files/viewer';

const IMAGE_DRAG_TYPE = 'application/x-harness-image';

/**
 * Message images and videos: click to open the photo viewer (with the thread's other media as its gallery), drag an image onto
 * the composer to attach. A local path (absolute, or relative to the thread's folder) is read through the file host.
 */
export function ImageVisual({
  src,
  alt,
  className,
  node: _node,
  ...props
}: ComponentProps<'img'> & ExtraProps) {
  const files = useThreadFiles();
  const openInThread = useOpenInThread();
  const path = typeof src === 'string' ? threadPath(src, files?.root) : src;
  const [url] = useImageUrls(typeof path === 'string' && path ? [path] : []);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'broken'>(
    'loading',
  );
  if (typeof path !== 'string' || !path) return null;
  const name = alt || path.split('/').pop()!;
  const isClip = isVideo(path);
  const open = () =>
    openInThread(path, {
      photos: [{ src: path, name, ...(isClip && { kind: 'video' }) }],
      index: 0,
    });
  if (status === 'broken' || url === null)
    return <BrokenImage name={name} layout="single" />;

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(IMAGE_DRAG_TYPE, JSON.stringify({ src: url, alt }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <button
      type="button"
      onClick={open}
      aria-label={`Open ${name}`}
      className={cn(
        'relative my-2 block max-h-60 max-w-[min(100%,20rem)] cursor-zoom-in overflow-hidden rounded-lg bg-muted focus-visible:outline-2 focus-visible:outline-offset-2',
        IMAGE_OUTLINE,
      )}
    >
      {status === 'loading' && <Skeleton className="h-40 w-60 rounded-none" />}
      {!!url && isClip && (
        <video
          src={url}
          muted
          preload="metadata"
          onLoadedData={() => setStatus('loaded')}
          onError={() => setStatus('broken')}
          className={cn(
            'block max-h-60 w-auto max-w-full',
            status === 'loading' && 'absolute size-0 opacity-0',
          )}
        />
      )}
      {!!url && isClip && status === 'loaded' && (
        <span className="absolute inset-0 grid place-items-center">
          <Play aria-hidden className="size-8 text-white drop-shadow" />
        </span>
      )}
      {!!url && !isClip && (
        <img
          {...props}
          src={url}
          alt={alt}
          draggable
          onDragStart={onDragStart}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('broken')}
          className={cn(
            'block max-h-60 w-auto max-w-full',
            status === 'loading' && 'absolute size-0 opacity-0',
            className,
          )}
        />
      )}
    </button>
  );
}

/** Wraps the composer: a message image dropped on it becomes an attachment. Sets `data-image-over` while one hovers. */
export function ImageDropTarget({ children }: { children: ReactNode }) {
  const { attachments } = usePromptInputController();
  const [isOver, setOver] = useState(false);

  const accepts = (e: DragEvent) =>
    e.dataTransfer.types.includes(IMAGE_DRAG_TYPE);
  const onDrop = async (e: DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    setOver(false);
    try {
      const { src, alt } = JSON.parse(
        e.dataTransfer.getData(IMAGE_DRAG_TYPE),
      ) as { src: string; alt?: string };
      const blob = await fetchImage(src);
      attachments.add([
        new File([blob], imageFileName(alt, blob.type), { type: blob.type }),
      ]);
    } catch {
      toast.error(
        "Couldn't attach that image; its host doesn't allow it to be copied",
      );
    }
  };

  return (
    <div
      data-image-over={isOver || undefined}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) =>
        !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)
      }
      onDrop={onDrop}
    >
      {children}
    </div>
  );
}
