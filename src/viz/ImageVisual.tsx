import { useState, type ComponentProps, type DragEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Download } from 'reicon-react';
import type { ExtraProps } from 'streamdown';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { download } from './exportVisual';

const IMAGE_DRAG_TYPE = 'application/x-harness-image';

/** Message images: click for a lightbox, drag onto the composer to attach. */
export function ImageVisual({ src, alt, className, node: _node, ...props }: ComponentProps<'img'> & ExtraProps) {
  const [isOpen, setOpen] = useState(false);
  const [isBroken, setBroken] = useState(false);
  if (typeof src !== 'string' || !src) return null;
  if (isBroken) return <span className="type-meta text-subtle-foreground italic">{alt || 'Image not available'}</span>;

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(IMAGE_DRAG_TYPE, JSON.stringify({ src, alt }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Open image${alt ? `: ${alt}` : ''}`} className="my-2 block max-w-full cursor-zoom-in rounded-lg ring-1 ring-border">
        <img {...props} src={src} alt={alt} draggable onDragStart={onDragStart} onError={() => setBroken(true)} className={cn('block max-h-80 max-w-full rounded-lg', className)} />
      </button>
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 sm:max-w-[min(calc(100vw-4rem),1100px)]">
          <div className="flex items-center gap-2 pr-8">
            <DialogTitle className="truncate type-title">{alt || 'Image'}</DialogTitle>
            <Button variant="ghost" size="icon-sm" aria-label="Download image" className="ml-auto" onClick={() => saveImage(src, alt)}>
              <Download />
            </Button>
          </div>
          <img src={src} alt={alt} draggable onDragStart={onDragStart} className="min-h-0 w-full flex-1 rounded-lg object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}

async function saveImage(src: string, alt?: string) {
  try {
    const blob = await fetchImage(src);
    download(imageFileName(alt, blob.type), blob);
  } catch {
    window.open(src, '_blank', 'noopener');
  }
}

async function fetchImage(src: string) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

function imageFileName(alt: string | undefined, type: string) {
  const ext = type.split('/')[1]?.replace('svg+xml', 'svg') || 'png';
  const base = (alt || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
  return `${base}.${ext}`;
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
