import { useEffect } from 'react';
import { useQueries } from '@tanstack/react-query';
import { host } from '../host/index.ts';
import { imageMime } from '../files/previews';
import { queryKeys } from '../queryKeys';

// A URL has a scheme (`data:`, `https:`, `blob:`); a Windows drive (`C:\`) looks like one, so it's checked first.
const isUrl = (src: string) => !/^[a-z]:[\\/]/i.test(src) && /^[a-z][a-z\d+.-]*:/i.test(src);

/** A path on this computer rather than a URL the page can load as is. */
export const isFilePath = (src: string) => !isUrl(src);

/**
 * Image sources as URLs the page can show: URLs as they are, absolute file paths read through the file host into object
 * URLs (revoked when the sources change or the caller goes). Per source: the URL, `undefined` while it loads, `null` when it can't be read.
 */
export function useImageUrls(srcs: string[]): (string | null | undefined)[] {
  const images = useQueries({ queries: srcs.map((src) => ({ queryKey: queryKeys.chat.imageBlob(src), queryFn: () => readImage(src), enabled: !!src && isFilePath(src), structuralSharing: false })), combine: (results) => results.map((result) => ({ blob: result.data, isError: result.isError })) });
  const urls = images.map(({ blob }) => blob ? URL.createObjectURL(blob) : undefined);
  useEffect(() => () => urls.forEach((url) => { if (url) URL.revokeObjectURL(url); }), [urls]);
  return srcs.map((src, i) => isFilePath(src) ? urls[i] ?? (images[i].isError ? null : undefined) : src);
}

/** Selects the file in Finder (Explorer, the file manager). */
export function revealFile(path: string) {
  const { dir, name } = splitPath(path);
  return host.fs.reveal(dir, name);
}

async function readImage(path: string) {
  const { dir, name } = splitPath(path);
  const content = await host.fs.read(dir, name);
  const type = /\.svg$/i.test(path) ? 'image/svg+xml' : imageMime(path);
  return new Blob([(content.kind === 'text' ? content.text : content.bytes) as BlobPart], { type });
}

// The file host reads paths relative to a root, so a file is read from its own folder.
export function splitPath(path: string) {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return { dir: cut < 0 ? '' : path.slice(0, cut) || '/', name: path.slice(cut + 1) };
}
