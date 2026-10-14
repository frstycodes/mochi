import type { AgentImage } from '../host/types/agent.ts';
import type { SentImage } from '../model.ts';

// Claude's image block takes exactly these (`ImageBlockParam` in @anthropic-ai/sdk); Codex's `image` input takes a data URL.
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const satisfies readonly AgentImage['mediaType'][];
// Claude rejects images over 5 MB; main caps the base64 at 6.9M chars (`electron/ipc/agent.ts`), which this stays under.
export const MAX_IMAGE_BYTES = 5_000_000;
export const MAX_IMAGES = 8;
const THUMB_PX = 240;

export const IMAGE_ERRORS = {
  accept: 'Only PNG, JPEG, GIF and WebP images can be sent to an agent',
  max_file_size: 'Images must be under 5 MB',
  max_files: `Up to ${MAX_IMAGES} images per message`,
} as const;

type Attached = { url: string; mediaType: string; filename?: string };

/** Why these attachments can't go to an agent; null when they all can. A restored draft can hold files the picker would refuse. */
export function imageProblem(files: Attached[]) {
  if (files.length > MAX_IMAGES) return IMAGE_ERRORS.max_files;
  if (files.some((f) => !isImageType(f.mediaType) || !f.url.startsWith('data:'))) return IMAGE_ERRORS.accept;
  if (files.some((f) => base64Of(f.url).length > (MAX_IMAGE_BYTES * 4) / 3 + 4)) return IMAGE_ERRORS.max_file_size;
  return null;
}

/** `files` carry data URLs: PromptInput converts its blob URLs on submit. Check them with `imageProblem` first. */
export function sentImages(files: Attached[]): Promise<SentImage[]> {
  return Promise.all(files.map(async (f) => ({ mediaType: f.mediaType as AgentImage['mediaType'], data: base64Of(f.url), thumb: await thumbnail(f.url) })));
}

export const agentImage = ({ mediaType, data }: SentImage): AgentImage => ({ mediaType, data });

/** A queued message's images back as composer attachments (Edit). */
export const imageFiles = (images: SentImage[]) => images.map((i, n) => new File([Uint8Array.from(atob(i.data), (c) => c.charCodeAt(0))], `image-${n + 1}.${i.mediaType.split('/')[1]}`, { type: i.mediaType }));

const isImageType = (type: string): type is AgentImage['mediaType'] => (IMAGE_TYPES as readonly string[]).includes(type);
const base64Of = (url: string) => url.slice(url.indexOf(',') + 1);

// The transcript keeps a small copy: the full image would land in threads.json with every message.
async function thumbnail(url: string) {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const scale = Math.min(1, THUMB_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return dataUrl(await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 }));
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
