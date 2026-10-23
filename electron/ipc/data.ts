import { app, BrowserWindow, dialog } from 'electron';
import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_REPLAY_BYTES, type DataHost } from '../../src/host/types/data.ts';
import { saveImage } from '@mochi/core/agents/images';
import { embedReplay, isSelfContained, replayFileName } from '../../src/replay/page.ts';
import { indexHtml } from '../window.ts';
import type { Handlers, ServedByCore } from './handlers.ts';

const replays = () => join(app.getPath('userData'), 'replays');
const replayFile = (threadId: string) => join(replays(), `${threadId}.jsonl`);

// Appends are serialized, so two flushes can't interleave their lines or both pass the cap check.
let appending: Promise<unknown> = Promise.resolve();
const capped = new Set<string>();

export const data = {
  async loadReplay(_sender, threadId) {
    const path = replayFile(threadId);
    await appending.catch(() => {});
    return readFile(path, 'utf8').catch(orNull);
  },
  async appendReplay(_sender, threadId, text) {
    const path = replayFile(threadId);
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
    await Promise.all(threadIds.map((id) => rm(replayFile(id), { force: true })));
  },
  async exportReplay(sender, payload, name) {
    const parsed = JSON.parse(payload);
    if (parsed?.version !== 1 || !parsed.recording?.base) throw new TypeError('payload must be a replay export');
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
    return saveImage(mediaType, base64);
  },
} satisfies Omit<Handlers<DataHost>, ServedByCore['data']>;

function orNull(error: NodeJS.ErrnoException) {
  if (error.code === 'ENOENT') return null;
  throw error;
}
