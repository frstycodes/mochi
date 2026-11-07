import { isFilePath } from '../chat/imageSrc';
import { PREVIEW_KINDS } from '../files/kinds';
import type { ActivityEntry } from '../model';
import { toolCall } from '../summary';
import type { Photo } from './photos';

const VIDEO = /\.(mp4|m4v|webm|mov|ogv)$/i;

export const isVideo = (src: string) =>
  src.startsWith('data:video/') || VIDEO.test(src.split(/[?#]/)[0]);

const isImagePath = (path: string) =>
  PREVIEW_KINDS.image.test(path) || PREVIEW_KINDS.svg.test(path);

/** A chat path relative to the thread's folder, made absolute; URLs and absolute paths stay as they are. */
export function threadPath(src: string, root: string | undefined) {
  if (!root || !isFilePath(src) || src.startsWith('/')) return src;
  return `${root}/${src.replace(/^\.\//, '')}`;
}

/**
 * Every image and video in the thread, in reading order, once each: what the viewer pages through. Sources stay as the
 * transcript has them (paths or URLs); the viewer resolves each one as it's shown.
 */
export function threadMedia(activity: ActivityEntry[], root?: string): Photo[] {
  const items = new Map<string, Photo>();
  for (const entry of activity)
    for (const { src, name } of entryMedia(entry, root))
      if (src && !items.has(src))
        items.set(src, { src, name, ...(isVideo(src) && { kind: 'video' }) });
  return [...items.values()];
}

/** One case per kind of transcript entry that shows media. */
function entryMedia(entry: ActivityEntry, root: string | undefined) {
  if (entry.kind === 'message' && entry.who === 'you')
    return numbered(entry.images);
  if (
    entry.kind === 'message' &&
    (entry.who === 'claude' || entry.who === 'codex')
  )
    return markdownImages(entry.text).map(({ src, alt }) => {
      const path = threadPath(src, root);
      return { src: path, name: alt || fileName(path) };
    });
  if (entry.kind === 'tool') return toolMedia(entry, root);
  return [];
}

function toolMedia(entry: ActivityEntry, root: string | undefined) {
  const call = toolCall(entry);
  const read =
    call.verb === 'Read' && isImagePath(call.target)
      ? [threadPath(call.target, root)]
      : [];
  const { generated } = entry;
  return [
    ...read.map((src) => ({ src, name: fileName(src) })),
    ...numbered(entry.images),
    ...(generated?.status === 'done' && generated.src
      ? [
          {
            src: generated.src,
            name: generated.prompt?.slice(0, 60) ?? 'Generated image',
          },
        ]
      : []),
  ];
}

const numbered = (srcs: string[] | undefined) =>
  (srcs ?? []).map((src, i) => ({ src, name: `Image ${i + 1}` }));

// GAP: markdown image syntax only, outside fenced code; a raw `<img>` in a reply isn't in the gallery.
const FENCE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1/gm;
const IMAGE = /!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;

function markdownImages(text: string) {
  return [...text.replace(FENCE, '').matchAll(IMAGE)].map(([, alt, src]) => ({
    alt,
    src,
  }));
}

const fileName = (src: string) =>
  isFilePath(src) ? (src.split(/[/\\]/).pop() ?? src) : 'Image';
