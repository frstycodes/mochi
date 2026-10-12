import { useState, type ComponentProps, type DragEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { ExtraProps } from 'streamdown';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { cn } from '@/lib/utils';
import { fetchImage, imageFileName, openFromScope } from '../photo/photos';

const IMAGE_DRAG_TYPE = 'application/x-harness-image';

/** Message images: click to open the photo viewer (with the thread's other images as its gallery), drag onto the composer to attach. */
export function ImageVisual({ src, alt, className, node: _node, ...props }: ComponentProps<'img'> & ExtraProps) {
  const [isBroken, setBroken] = useState(false);
  if (typeof src !== 'string' || !src) return null;
  if (isBroken) return <span className="type-meta text-subtle-foreground italic">{alt || 'Image not available'}</span>;

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(IMAGE_DRAG_TYPE, JSON.stringify({ src, alt }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <button type="button" onClick={(e) => openFromScope(e.currentTarget.querySelector('img')!)} aria-label={`Open image${alt ? `: ${alt}` : ''}`} className="my-2 block max-w-full cursor-zoom-in rounded-lg border">
      <img {...props} data-photo src={src} alt={alt} draggable onDragStart={onDragStart} onError={() => setBroken(true)} className={cn('block max-h-80 max-w-full rounded-lg', className)} />
    </button>
  );
}

/** Wraps the composer: a message image dropped on it becomes an attachment. Sets `data-image-over` while one hovers. */
export function ImageDropTarget({ children }: { children: ReactNode }) {
  const { attachments } = usePromptInputController();
  const [isOver, setOver] = useState(false);

  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(IMAGE_DRAG_TYPE);
  const onDrop = async (e: DragEvent) => {
    if (!accepts(e)) return;
    e.preventDefault();
    setOver(false);
    try {
      const { src, alt } = JSON.parse(e.dataTransfer.getData(IMAGE_DRAG_TYPE)) as { src: string; alt?: string };
      const blob = await fetchImage(src);
      attachments.add([new File([blob], imageFileName(alt, blob.type), { type: blob.type })]);
    } catch {
      toast.error("Couldn't attach that image; its host doesn't allow it to be copied");
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
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={onDrop}
    >
      {children}
    </div>
  );
}
