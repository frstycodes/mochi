import { app, BrowserWindow, dialog } from 'electron';
import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from '../../src/chat/images.ts';
import { MAX_REPLAY_BYTES, type DataHost } from '../../src/host/types/data.ts';
import { imageDir, saveImage, sweepImages } from '../agents/images.ts';
import { embedReplay, isSelfContained, replayFileName } from '../../src/replay/page.ts';
import { indexHtml } from '../window.ts';
import { record, string, type Handlers } from './handlers.ts';
import { threadStore } from './threadStore.ts';

const MAX_CHARS = 64 * 1024 * 1024;
const store = () => threadStore(join(app.getPath('userData'), 'threads'), join(app.getPath('userData'), 'threads.json'));
const replays = () => join(app.getPath('userData'), 'replays');
const replayFile = (threadId: unknown) => {
  const id = string(threadId, 'threadId', 128);
  if (!/^[\w-]+$/.test(id)) throw new TypeError('threadId must be letters, digits, - or _');
  return join(replays(), `${id}.jsonl`);
};

// Saves are serialized and written to a temp file first, so a quit mid-write leaves the previous file whole.
let writing: Promise<void> = Promise.resolve();
// Appends too, so two flushes can't interleave their lines or both pass the cap check.
let appending: Promise<unknown> = Promise.resolve();
const capped = new Set<string>();
// Every window loads; the first load of a launch sweeps.
let hasSwept = false;

export const data = {
  async load() {
    await writing;
    const files = await store().load();
    if (files && !hasSwept) {
      hasSwept = true;
      void sweepUnreferenced([files.index, ...files.threads]).catch((error: unknown) => console.error('Image sweep failed', error));
    }
    return files;
  },
  async save(_sender, index, threads) {
    const text = string(index, 'index', MAX_CHARS);
    // Per thread: the cap bounds one IPC string, and no thread comes near it.
    const changed = Object.fromEntries(Object.entries(record(threads, 'threads')).map(([id, json]) => [id, string(json, `threads.${id}`, MAX_CHARS)]));
    writing = writing.catch(() => {}).then(() => store().save(text, changed));
    return writing;
  },
  async loadReplay(_sender, threadId) {
    const path = replayFile(threadId);
    await appending.catch(() => {});
    return readFile(path, 'utf8').catch(orNull);
  },
  async appendReplay(_sender, threadId, lines) {
    const path = replayFile(threadId);
    const text = string(lines, 'lines', MAX_REPLAY_BYTES);
    const next = appending.catch(() => {}).then(async () => {
      const size = (await stat(path).catch(() => null))?.size ?? 0;
      await mkdir(replays(), { recursive: true });
      if (size + Buffer.byteLength(text) <= MAX_REPLAY_BYTES) {
        await appendFile(path, text, { mode: 0o600 });
        return true;
      }
      // The replay stops at this line; anything a later, smaller append adds after it is never read.
      if (!capped.has(path)) await appendFile(path, `${JSON.stringify({ t: Date.now(), capped: true })}\n`, { mode: 0o600 });
      capped.add(path);
      return false;
    });
    appending = next;
    return next;
  },
  async replayUsage() {
    const names = await readdir(replays()).catch(() => [] as string[]);
    const sizes = await Promise.all(names.filter((n) => n.endsWith('.jsonl')).map((n) => stat(join(replays(), n)).then((s) => s.size, () => 0)));
    return { threads: sizes.length, bytes: sizes.reduce((a, b) => a + b, 0) };
  },
  async clearReplays(_sender, threadIds) {
    await appending.catch(() => {});
    capped.clear();
    if (threadIds === undefined) return rm(replays(), { recursive: true, force: true });
    if (!Array.isArray(threadIds) || threadIds.length > 10_000) throw new TypeError('threadIds must be an array');
    await Promise.all(threadIds.map((id) => rm(replayFile(id), { force: true })));
  },
  async exportReplay(sender, payload, title) {
    const name = string(title, 'title', 512);
    const parsed = record(JSON.parse(string(payload, 'payload', MAX_CHARS)), 'payload');
    if (parsed.version !== 1 || !record(parsed.recording, 'payload.recording').base) throw new TypeError('payload must be a replay export');
    if (process.env.VITE_DEV_SERVER_URL) throw new Error('Exporting needs the built app: the dev server page loads its scripts from the network');
    const html = await readFile(indexHtml, 'utf8');
    if (!isSelfContained(html)) throw new Error('This build loads scripts from separate files, so its page can’t be shared on its own');
    const window = BrowserWindow.fromWebContents(sender);
    const options = { defaultPath: join(app.getPath('downloads'), replayFileName(name)), filters: [{ name: 'Web page', extensions: ['html'] }] } satisfies Electron.SaveDialogOptions;
    const { canceled, filePath } = await (window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options));
    if (canceled || !filePath) return null;
    await writeFile(filePath, embedReplay(html, parsed, name));
    return filePath;
  },
  async saveImage(_sender, mediaType, base64) {
    if (!(IMAGE_TYPES as readonly unknown[]).includes(mediaType)) throw new TypeError(`mediaType must be one of ${IMAGE_TYPES.join(', ')}`);
    return saveImage(mediaType as string, string(base64, 'base64', Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4));
  },
} satisfies Handlers<DataHost>;

// Replays can name an image the thread itself no longer shows (after a rewind), so they count as references too.
async function sweepUnreferenced(threads: string[]) {
  const dir = imageDir();
  if (!dir) return;
  const startedAt = Date.now();
  const names = (await readdir(replays()).catch(() => [] as string[])).filter((n) => n.endsWith('.jsonl'));
  const recordings = await Promise.all(names.map((n) => readFile(join(replays(), n), 'utf8').catch(() => '')));
  await sweepImages(dir, [...threads, ...recordings], startedAt);
}

function orNull(error: NodeJS.ErrnoException) {
  if (error.code === 'ENOENT') return null;
  throw error;
}
