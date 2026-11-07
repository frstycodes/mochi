import { useContext } from 'react';
import { createRequestStore } from '@/lib/requestStore';
import { revealFile, isFilePath } from '../chat/imageSrc';
import { threadCwd } from '../host/cwd';
import { ThreadOriginContext, type ThreadOrigin } from '../remote/origin';
import { useGetState } from '../store';
import { useOptionalVizThreadId } from '../viz/WidgetVisual';
import { download } from '../viz/exportVisual';
import { threadMedia } from './gallery';

export interface Photo {
  /** A URL, or a file path the viewer reads (on the thread's own computer) as it's shown. */
  src: string;
  name: string;
  kind?: 'video';
  /** Selects the image's file in Finder; set when it lives on disk (an image the agent generated). */
  reveal?: () => void;
}

export interface PhotoRequest {
  photos: Photo[];
  index: number;
  /** The thread the photos came from, so a path is read on the computer it names. */
  thread?: { id: string; origin: ThreadOrigin };
}

const store = createRequestStore<PhotoRequest>();

/** Opens the viewer on `photos[index]`; the others are its gallery. `null` closes it. */
export const openPhotos = store.open;
export const usePhotoRequest = store.use;

/**
 * Opens the viewer on `src` with every image and video in the current thread as its gallery. Outside a thread, or for a
 * source the thread doesn't hold (a message still being sent), it opens `fallback` instead.
 */
export function useOpenInThread() {
  const threadId = useOptionalVizThreadId();
  const getState = useGetState();
  const origin = useContext(ThreadOriginContext);
  // Read on click, not subscribed: every image in the chat holds this, and the thread changes with every streamed token.
  return (src: string, fallback: PhotoRequest) => {
    const thread = getState().threads.find((t) => t.id === threadId);
    const root =
      thread && origin.kind === 'local' ? threadCwd(thread) : undefined;
    const photos = thread
      ? threadMedia(thread.activity, root ?? undefined)
      : [];
    const index = photos.findIndex((p) => p.src === src);
    if (!thread || index < 0) return openPhotos(fallback);
    openPhotos({
      photos: photos.map((p) =>
        origin.kind === 'local' && isFilePath(p.src)
          ? { ...p, reveal: () => void revealFile(p.src) }
          : p,
      ),
      index,
      thread: { id: thread.id, origin },
    });
  };
}

export async function saveImage(photo: Photo) {
  try {
    const blob = await fetchImage(photo.src);
    download(imageFileName(photo.name, blob.type), blob);
  } catch {
    window.open(photo.src, '_blank', 'noopener');
  }
}

/** The clipboard only takes PNG everywhere, so anything else is redrawn to one first. */
export async function copyImage(photo: Photo) {
  const blob = await fetchImage(photo.src);
  const png = blob.type === 'image/png' ? blob : await toPng(photo.src);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

export async function fetchImage(src: string) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

async function toPng(src: string) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  const canvas = Object.assign(document.createElement('canvas'), {
    width: img.naturalWidth,
    height: img.naturalHeight,
  });
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode PNG'))),
      'image/png',
    ),
  );
}

export function imageFileName(name: string | undefined, type: string) {
  const ext = type.split('/')[1]?.replace('svg+xml', 'svg') || 'png';
  const stem = (name ?? '').replace(/\.[a-z0-9]+$/i, '');
  const base =
    stem
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'image';
  return `${base}.${ext}`;
}
