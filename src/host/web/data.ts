import type { DataHost } from '../types/data.ts';
import { embedReplay, isSelfContained, replayFileName } from '../../replay/page.ts';

// The web build and the artifact run on demo data that starts fresh on every load; recordings last for the page.
const replays = new Map<string, string>();

export const data: DataHost = {
  async load() {
    return null;
  },
  async save() {},
  async loadReplay(threadId) {
    return replays.get(threadId) ?? null;
  },
  async appendReplay(threadId, lines) {
    replays.set(threadId, (replays.get(threadId) ?? '') + lines);
    return true;
  },
  async replayUsage() {
    return { threads: replays.size, bytes: [...replays.values()].reduce((n, text) => n + new Blob([text]).size, 0) };
  },
  async clearReplays(threadIds) {
    if (!threadIds) replays.clear();
    else for (const id of threadIds) replays.delete(id);
  },
  /** Downloads the page this app was loaded from, when it is the single-file build. */
  async exportReplay(payload, title) {
    const html = await fetch(location.href.split('#')[0]).then((r) => r.text());
    if (!isSelfContained(html)) throw new Error('Exporting needs the built app: this page loads its scripts from the dev server');
    const name = replayFileName(title);
    const url = URL.createObjectURL(new Blob([embedReplay(html, JSON.parse(payload), title)], { type: 'text/html' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return name;
  },
  // Nothing outlives the page here, so the original stays as the data URL it came in.
  async saveImage(mediaType, base64) {
    return `data:${mediaType};base64,${base64}`;
  },
};
