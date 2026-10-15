import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Keeps an image an agent's tool returned (base64) as a file, so the transcript stores a path, not the bytes. Returns the absolute path. */
export type SaveImage = (mediaType: string, base64: string) => string;

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

// Set by main at launch (`userData/images`); no `electron` import here, so the mappers' node tests can load this module.
let dir: string | undefined;
export const setImageDir = (path: string) => void (dir = path);

// Named by content, so the same screenshot returned twice is one file.
// GAP: nothing deletes these; a thread's images outlive the thread until a cleanup lands.
export const saveImage: SaveImage = (mediaType, base64) => {
  if (!dir) throw new Error('Image folder not set (setImageDir runs at launch)');
  const file = join(dir, `${createHash('sha256').update(base64).digest('hex').slice(0, 32)}.${EXTENSIONS[mediaType] ?? 'png'}`);
  if (existsSync(file)) return file;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
};
