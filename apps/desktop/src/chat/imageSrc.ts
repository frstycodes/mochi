import { useEffect, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { host } from '../host/index.ts';
import { imageMime } from '../files/kinds';
import { queryKeys } from '../queryKeys';
import { useThreadOrigin } from '../remote/origin';
import {
  askMachine,
  base64Blob,
  remoteIo,
  type RemoteIo,
} from '../remote/threadIo';
import { useOptionalVizThreadId } from '../viz/WidgetVisual';

// A URL has a scheme (`data:`, `https:`, `blob:`); a Windows drive (`C:\`) looks like one, so it's checked first.
const isUrl = (src: string) =>
  !/^[a-z]:[\\/]/i.test(src) && /^[a-z][a-z\d+.-]*:/i.test(src);

/** A path on this computer rather than a URL the page can load as is. */
export const isFilePath = (src: string) => !isUrl(src);

/**
 * Image sources as URLs the page can show: URLs as they are, absolute file paths read through the file host into object
 * URLs (revoked when the sources change or the caller goes). On another computer's thread a path names that computer's file,
 * so it's asked for there (`read-image`), never read from the same path here. Per source: the URL, `undefined` while it
 * loads, `null` when it can't be read.
 */
export function useImageUrls(srcs: string[]): (string | null | undefined)[] {
  const origin = useThreadOrigin();
  const threadId = useOptionalVizThreadId();
  const owner = threadId ? remoteIo(origin, threadId, 'read') : null;
  const remote = owner?.kind === 'remote' ? owner : null;
  const isRemote = origin.kind === 'remote';
  const canAsk = remote?.machine.status === 'online';
  const images = useQueries({
    queries: srcs.map((src) => ({
      queryKey: remote
        ? queryKeys.remote.read(remote.machine.id, [
            remote.threadId,
            'image',
            src,
          ])
        : queryKeys.chat.imageBlob(src),
      queryFn: () => (remote ? askImage(remote, src) : readImage(src)),
      enabled: !!src && isFilePath(src) && (isRemote ? canAsk : true),
      structuralSharing: false,
    })),
    combine: (results) =>
      results.map((result) => ({ blob: result.data, isError: result.isError })),
  });
  const urls = useObjectUrls(images.map(({ blob }) => blob));
  return srcs.map((src, i) => {
    if (!isFilePath(src)) return src;
    const blob = images[i].blob;
    if (blob) return urls.get(blob);
    return images[i].isError || (isRemote && !canAsk) ? null : undefined;
  });
}

/** One object URL per loaded blob, made and revoked by an effect so StrictMode's re-run gets live ones. */
function useObjectUrls(blobs: (Blob | undefined)[]) {
  const [shown, setShown] = useState(blobs);
  if (
    blobs.length !== shown.length ||
    blobs.some((blob, i) => blob !== shown[i])
  )
    setShown(blobs);
  const [urls, setUrls] = useState(() => new Map<Blob, string>());
  useEffect(() => {
    const made = new Map(
      shown.flatMap((blob) =>
        blob ? [[blob, URL.createObjectURL(blob)] as const] : [],
      ),
    );
    // oxlint-disable-next-line react/set-state-in-effect -- an object URL is an external resource: made and revoked by this effect
    setUrls(made);
    return () => made.forEach((url) => URL.revokeObjectURL(url));
  }, [shown]);
  return urls;
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
  return new Blob(
    [(content.kind === 'text' ? content.text : content.bytes) as BlobPart],
    { type },
  );
}

async function askImage({ machine, threadId }: RemoteIo, path: string) {
  const { base64, mediaType } = await askMachine(machine.id, {
    type: 'read-image',
    threadId,
    path,
  });
  return base64Blob(base64, mediaType);
}

// The file host reads paths relative to a root, so a file is read from its own folder.
export function splitPath(path: string) {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return {
    dir: cut < 0 ? '' : path.slice(0, cut) || '/',
    name: path.slice(cut + 1),
  };
}
