import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Keeps an image an agent's tool returned (base64) as a file, so the transcript stores a path, not the bytes. Returns the absolute path. */
export type SaveImage = (mediaType: string, base64: string) => string;

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

// Set by main at launch (`userData/images`); no `electron` import here, so the mappers' node tests can load this module.
let dir: string | undefined;
export const setImageDir = (path: string) => void (dir = path);
export const imageDir = () => dir;

// Named by content, so the same screenshot returned twice is one file; `sweepImages` deletes the ones nothing refers to.
export const saveImage: SaveImage = (mediaType, base64) => {
  if (!dir) throw new Error('Image folder not set (setImageDir runs at launch)');
  const file = join(dir, `${createHash('sha256').update(base64).digest('hex').slice(0, 32)}.${EXTENSIONS[mediaType] ?? 'png'}`);
  // Touched when reused, so a sweep already running (it spares files newer than its start) keeps it.
  if (existsSync(file)) return (utimesSync(file, new Date(), new Date()), file);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
};

/**
 * Deletes the images no saved text names and that weren't written or reused since `startedAt`. Matched by file name (a
 * content hash) in the raw text, so it holds however the path was escaped. Per-thread deletion would be unsafe: one file
 * can belong to several threads.
 */
export async function sweepImages(folder: string, saved: string[], startedAt: number) {
  const names = (await readdir(folder).catch(() => [] as string[])).filter((name) => /^[0-9a-f]{32}\.\w+$/.test(name) && !saved.some((text) => text.includes(name)));
  const isStale = await Promise.all(names.map((name) => stat(join(folder, name)).then((s) => s.mtimeMs < startedAt, () => false)));
  const orphans = names.filter((_, i) => isStale[i]);
  await Promise.all(orphans.map((name) => rm(join(folder, name), { force: true })));
  return orphans;
}
