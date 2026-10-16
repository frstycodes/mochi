import { createRequestStore } from '@/lib/requestStore';
import { download } from '../viz/exportVisual';

export interface Photo {
  src: string;
  name: string;
  /** Selects the image's file in Finder; set when it lives on disk (an image the agent generated). */
  reveal?: () => void;
}

export interface PhotoRequest {
  photos: Photo[];
  index: number;
}

const store = createRequestStore<PhotoRequest>();

/** Opens the viewer on `photos[index]`; the others are its gallery. `null` closes it. */
export const openPhotos = store.open;
export const usePhotoRequest = store.use;

/** Every `img[data-photo]` in the same `[data-photo-scope]` (a thread's messages) is one gallery, in reading order. */
export function openFromScope(img: HTMLImageElement) {
  const scope = img.closest('[data-photo-scope]') ?? document;
  const imgs = [...scope.querySelectorAll<HTMLImageElement>('img[data-photo]')];
  const photos = imgs.map((el) => ({ src: el.currentSrc || el.src, name: el.alt || 'Image' }));
  openPhotos({ photos, index: Math.max(0, imgs.indexOf(img)) });
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
  const canvas = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode PNG'))), 'image/png'));
}

export function imageFileName(name: string | undefined, type: string) {
  const ext = type.split('/')[1]?.replace('svg+xml', 'svg') || 'png';
  const stem = (name ?? '').replace(/\.[a-z0-9]+$/i, '');
  const base = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
  return `${base}.${ext}`;
}
