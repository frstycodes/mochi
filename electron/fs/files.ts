import { constants, watch, type FSWatcher } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WebContents } from 'electron';
import type { FileContent, FsChange, WriteResult } from '../../src/host/types/fs.ts';
import { resolveInside, resolveRoot } from './contain.ts';

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_BYTES = 50 * 1024 * 1024;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|pdf)$/i;
const UNWATCHED = /(^|[/\\])(\.git|node_modules)([/\\]|$)/;

export async function readInside(root: string, rel: string): Promise<FileContent> {
  const real = await resolveInside(root, rel);
  const info = await stat(real);
  if (!info.isFile()) throw new Error(`${rel} is not a file`);
  if (info.size > MAX_BYTES) throw new Error(`${rel} is larger than ${MAX_BYTES / 1024 / 1024} MB`);
  const bytes = await readFile(real);
  const isText = bytes.length <= MAX_TEXT_BYTES && !BINARY_EXT.test(rel) && !bytes.subarray(0, 8000).includes(0);
  return isText ? { kind: 'text', text: bytes.toString('utf8'), mtimeMs: info.mtimeMs } : { kind: 'binary', bytes, mtimeMs: info.mtimeMs };
}

/** Only overwrites an existing file, and only when nobody else changed it since the caller read it. */
export async function writeInside(root: string, rel: string, text: string, { baseMtimeMs, force = false }: { baseMtimeMs: number; force?: boolean }): Promise<WriteResult> {
  const real = await resolveInside(root, rel);
  const info = await stat(real);
  if (!info.isFile()) throw new Error(`${rel} is not a file`);
  if (!force && info.mtimeMs !== baseMtimeMs) return { status: 'conflict', text: await readFile(real, 'utf8'), mtimeMs: info.mtimeMs };
  // O_NOFOLLOW: a symlink swapped in after resolveInside can't redirect the write.
  const handle = await open(real, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
  try {
    await handle.writeFile(text, 'utf8');
  } finally {
    await handle.close();
  }
  return { status: 'saved', mtimeMs: (await stat(real)).mtimeMs };
}

const watchers = new Map<string, { watcher: FSWatcher; count: number }>();

export async function watchRoot(sender: WebContents, root: string) {
  const key = `${sender.id}\0${root}`;
  const existing = watchers.get(key);
  if (existing) return void existing.count++;
  const realRoot = await resolveRoot(root);
  const watcher = watch(realRoot, { recursive: true }, (_event, file) => {
    if (!file || UNWATCHED.test(file) || sender.isDestroyed()) return;
    sender.send('fs:onChange', { root, path: file.split(path.sep).join('/') } satisfies FsChange);
  });
  watchers.set(key, { watcher, count: 1 });
  sender.once('destroyed', () => {
    watcher.close();
    watchers.delete(key);
  });
}

export function unwatchRoot(sender: WebContents, root: string) {
  const key = `${sender.id}\0${root}`;
  const entry = watchers.get(key);
  if (!entry || --entry.count > 0) return;
  entry.watcher.close();
  watchers.delete(key);
}
