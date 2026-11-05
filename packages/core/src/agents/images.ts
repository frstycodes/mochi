import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/** Keeps an image an agent's tool returned (base64) as a file, so the transcript stores a path, not the bytes. Returns the absolute path. */
export type SaveImage = (mediaType: string, base64: string) => string;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

// Set by main at launch (`userData/images`); no `electron` import here, so the mappers' node tests can load this module.
let dir: string | undefined;
export const setImageDir = (path: string) => void (dir = path);
export const imageDir = () => dir;

// Named by content, so the same screenshot returned twice is one file; `sweepImages` deletes the ones nothing refers to.
export const saveImage: SaveImage = (mediaType, base64) => {
  if (!dir)
    throw new Error('Image folder not set (setImageDir runs at launch)');
  const file = join(
    dir,
    `${createHash('sha256').update(base64).digest('hex').slice(0, 32)}.${EXTENSIONS[mediaType] ?? 'png'}`,
  );
  // Touched when reused, so a sweep already running (it spares files newer than its start) keeps it.
  if (existsSync(file)) return (utimesSync(file, new Date(), new Date()), file);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
};

// Beside `images`, so both setters (main and Core) place it without a second path to pass.
const attachmentDir = () => dir && join(dirname(dir), 'attachments');

/** Keeps a file you attached that isn't sent inline as an image, so the agent can read it by path. Returns the absolute path. */
export type SaveAttachment = (filename: string, base64: string) => string;

// Under a content-hash folder, so the agent sees the file's own name and two files with one name don't collide.
export const saveAttachment: SaveAttachment = (filename, base64) => {
  const root = attachmentDir();
  if (!root)
    throw new Error('Image folder not set (setImageDir runs at launch)');
  const folder = join(
    root,
    createHash('sha256').update(base64).digest('hex').slice(0, 32),
  );
  const file = join(folder, safeName(filename));
  if (existsSync(file)) {
    const now = new Date();
    utimesSync(folder, now, now);
    return file;
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
};

/** A name that stays one path segment: no separators, control characters or leading dots, at most 120 characters. */
export function safeName(filename: string) {
  const name = basename(filename.replaceAll('\\', '/'))
    // oxlint-disable-next-line no-control-regex -- control characters are what this strips from a file name
    .replace(/[\u0000-\u001f\u007f:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (!name) return 'attachment';
  if (name.length <= 120) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
  return name.slice(0, 120 - ext.length) + ext;
}

/**
 * Deletes the images no saved text names and that weren't written or reused since `startedAt`. Matched by file name (a
 * content hash) in the raw text, so it holds however the path was escaped. Per-thread deletion would be unsafe: one file
 * can belong to several threads.
 */
export const sweepImages = (
  folder: string,
  saved: string[],
  startedAt: number,
) => sweep(folder, /^[0-9a-f]{32}\.\w+$/, saved, startedAt);

/** The same for attached files: each is a content-hash folder, which the saved message text names in its path. */
export const sweepAttachments = (
  folder: string,
  saved: string[],
  startedAt: number,
) => sweep(folder, /^[0-9a-f]{32}$/, saved, startedAt);

async function sweep(
  folder: string,
  pattern: RegExp,
  saved: string[],
  startedAt: number,
) {
  const names = (await readdir(folder).catch(() => [] as string[])).filter(
    (name) => pattern.test(name) && !saved.some((text) => text.includes(name)),
  );
  const isStale = await Promise.all(
    names.map((name) =>
      stat(join(folder, name)).then(
        (s) => s.mtimeMs < startedAt,
        () => false,
      ),
    ),
  );
  const orphans = names.filter((_, i) => isStale[i]);
  await Promise.all(
    orphans.map((name) =>
      rm(join(folder, name), { force: true, recursive: true }),
    ),
  );
  return orphans;
}
