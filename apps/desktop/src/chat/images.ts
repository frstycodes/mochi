import type { AgentImage } from '../host/types/agent.ts';
import type { DataHost } from '../host/types/data.ts';
import type { SentImage } from '../model.ts';

// Claude's image block takes exactly these (`ImageBlockParam` in @anthropic-ai/sdk); Codex's `image` input takes a data URL.
export const IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const satisfies readonly AgentImage['mediaType'][];
// Claude rejects images over 5 MB; main caps the base64 at 6.9M chars (`electron/ipc/agent.ts`), which this stays under.
export const MAX_IMAGE_BYTES = 5_000_000;
// Any other file is kept on disk for the agent to read; `saveAttachment` in `packages/schema/src/ipc/data.ts` caps it the same.
export const MAX_FILE_BYTES = 20_000_000;
// The relay takes at most 8 images a message (`packages/schema/src/relay.ts`), and inline images are a subset of these.
export const MAX_ATTACHMENTS = 8;
const THUMB_PX = 240;

export const ATTACHMENT_ERRORS = {
  accept: 'This file can’t be attached',
  max_file_size: 'Files must be under 20 MB',
  max_files: `Up to ${MAX_ATTACHMENTS} files per message`,
} as const;

type Attached = { url: string; mediaType: string; filename?: string };

/** Goes to the agent inline as an image: a type both agents take, under 5 MB. Anything else goes as a file path. */
export const isInlineImage = (f: Attached) =>
  isImageType(f.mediaType) &&
  f.url.startsWith('data:') &&
  base64Of(f.url).length <= base64Cap(MAX_IMAGE_BYTES);

/**
 * Why these attachments can't go to an agent; null when they all can. A restored draft can hold files the picker would
 * refuse. `inlineOnly` names where only inline images can go (another computer, a side chat), which keeps no files.
 */
export function attachmentProblem(files: Attached[], inlineOnly?: string) {
  if (files.length > MAX_ATTACHMENTS) return ATTACHMENT_ERRORS.max_files;
  if (files.some((f) => !f.url.startsWith('data:')))
    return ATTACHMENT_ERRORS.accept;
  if (inlineOnly && !files.every(isInlineImage))
    return `Only PNG, JPEG, GIF and WebP images under 5 MB can go to ${inlineOnly}`;
  if (files.some((f) => base64Of(f.url).length > base64Cap(MAX_FILE_BYTES)))
    return ATTACHMENT_ERRORS.max_file_size;
  return null;
}

/**
 * Keeps the files that don't go inline (`saveAttachment`) and adds their paths to `text`, for the agent to read with its
 * own tools. The text comes back unchanged when every file is an inline image.
 */
export async function withAttachedFiles(
  text: string,
  files: Attached[],
  saveAttachment: DataHost['saveAttachment'],
) {
  const others = files.filter((f) => !isInlineImage(f));
  if (others.length === 0) return text;
  const paths = await Promise.all(
    others.map((f) =>
      saveAttachment(f.filename || 'attachment', base64Of(f.url)),
    ),
  );
  return attachedText(text, paths);
}

export const attachedText = (text: string, paths: string[]) =>
  [text, `Attached files:\n${paths.map((p) => `- \`${p}\``).join('\n')}`]
    .filter(Boolean)
    .join('\n\n');

/**
 * `files` carry data URLs: PromptInput converts its blob URLs on submit. Check them with `attachmentProblem` first. `saveImage` is
 * the host's, passed in so main (which imports this file's limits) never loads the renderer host.
 */
export function sentImages(
  files: Attached[],
  saveImage: DataHost['saveImage'],
): Promise<SentImage[]> {
  return Promise.all(
    files.filter(isInlineImage).map(async (f) => {
      const mediaType = f.mediaType as AgentImage['mediaType'];
      const data = base64Of(f.url);
      // Keeping the original is for the viewer only; the message still goes out with the thumb if it can't be saved.
      const [thumb, original] = await Promise.all([
        thumbnail(f.url),
        saveImage(mediaType, data).catch(() => undefined),
      ]);
      return { mediaType, data, thumb, ...(original && { original }) };
    }),
  );
}

export const agentImage = ({ mediaType, data }: SentImage): AgentImage => ({
  mediaType,
  data,
});

/** What the transcript keeps for an image you sent: the original when it was kept, so the viewer shows it full size. */
export const shownImage = (image: SentImage) => image.original ?? image.thumb;

/** A queued message's images back as composer attachments (Edit). */
export const imageFiles = (images: SentImage[]) =>
  images.map(
    (i, n) =>
      new File(
        [Uint8Array.from(atob(i.data), (c) => c.charCodeAt(0))],
        `image-${n + 1}.${i.mediaType.split('/')[1]}`,
        { type: i.mediaType },
      ),
  );

const isImageType = (type: string): type is AgentImage['mediaType'] =>
  (IMAGE_TYPES as readonly string[]).includes(type);
const base64Of = (url: string) => url.slice(url.indexOf(',') + 1);
const base64Cap = (bytes: number) => Math.ceil((bytes * 4) / 3) + 4;

// A small copy for where the original can't be kept: the full image would land in the saved thread with every message.
async function thumbnail(url: string) {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const scale = Math.min(1, THUMB_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return dataUrl(
    await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 }),
  );
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
