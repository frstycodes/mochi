import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { app, type Session, type WebContents } from 'electron';
import type { BrowserEvent } from '@mochi/domain/host/types/browser';
import { uniqueName } from './filename.ts';

export interface FinishedDownload {
  name: string;
  path: string;
  /** Epoch ms. */
  at: number;
}

type Route = (wc: WebContents) => { id: string; owner: WebContents } | null;

const PROGRESS_INTERVAL_MS = 250;
const FINISHED_LIMIT = 20;

const trackedSessions = new WeakSet<Session>();
const finished = new Map<string, FinishedDownload[]>();
// Paths of downloads still writing: a second download of the same name must not pick one before the first file lands.
const reserved = new Set<string>();

/** Saves every download of `ses` into the Downloads folder without a dialog and reports it to the tab that started it. */
export function trackDownloads(ses: Session, route: Route) {
  if (trackedSessions.has(ses)) return;
  trackedSessions.add(ses);
  ses.on('will-download', (_event, item, wc) => {
    const target = route(wc);
    const dir = app.getPath('downloads');
    const name = uniqueName(
      basename(item.getFilename()) || 'download',
      (n) => reserved.has(join(dir, n)) || existsSync(join(dir, n)),
    );
    const path = join(dir, name);
    reserved.add(path);
    item.setSavePath(path);
    const emit = (state: 'progress' | 'done' | 'failed') => {
      if (!target || target.owner.isDestroyed()) return;
      target.owner.send('browser:onEvent', {
        id: target.id,
        type: 'download',
        name,
        path,
        state,
        received: item.getReceivedBytes(),
        total: item.getTotalBytes(),
      } satisfies BrowserEvent);
    };
    let sentAt = 0;
    item.on('updated', (_e, state) => {
      if (state !== 'progressing' || Date.now() - sentAt < PROGRESS_INTERVAL_MS)
        return;
      sentAt = Date.now();
      emit('progress');
    });
    item.once('done', (_e, state) => {
      reserved.delete(path);
      emit(state === 'completed' ? 'done' : 'failed');
      if (state === 'completed' && target)
        remember(target.id, { name, path, at: Date.now() });
    });
  });
}

/** Downloads view `id` finished at or after `since` (epoch ms), oldest first. */
export function downloadsSince(id: string, since: number) {
  return (finished.get(id) ?? []).filter((d) => d.at >= since);
}

function remember(id: string, download: FinishedDownload) {
  finished.set(
    id,
    [...(finished.get(id) ?? []), download].slice(-FINISHED_LIMIT),
  );
}
