import { host } from '@/host';
import { threadCwd } from '@/host/cwd';
import type { FileContent } from '@/host/types/fs';
import { createRequestStore } from '@/lib/requestStore';
import { useThread } from '../store';
import { fileLink } from '../terminal/links';
import { useVizThreadId } from '../viz/WidgetVisual';

/** A file in the thread's folder (chat paths, work log rows) or one the user attached in the composer. */
export type ViewerFile =
  | {
      source: 'workspace';
      threadId: string;
      root: string;
      path: string;
      line?: number;
    }
  | { source: 'attachment'; name: string; url: string; mediaType?: string };

export interface FileRequest {
  files: ViewerFile[];
  index: number;
}

const store = createRequestStore<FileRequest>();

/** Opens the viewer on `files[index]`; the others are what prev/next step through. `null` closes it. */
export const openFiles = store.open;
export const useFileRequest = store.use;

export type ThreadFiles = { threadId: string; root: string };

/** The folder that chat paths in the current thread resolve against; `null` for a thread without one. */
export function useThreadFiles(): ThreadFiles | null {
  const threadId = useVizThreadId();
  const thread = useThread(threadId);
  const root = thread && threadCwd(thread);
  // Stable while the folder is, so effects keyed on it (a row loading its file) don't restart on every thread update.
  return root ? { threadId, root } : null;
}

/** Every `[data-file-link]` in the same `[data-file-scope]` (one message, one work log) is one set, in reading order. */
export function openFromScope(el: HTMLElement, base: ThreadFiles) {
  const scope = el.closest('[data-file-scope]') ?? document;
  const links = [
    ...new Set(
      [...scope.querySelectorAll<HTMLElement>('[data-file-link]')].map(
        (e) => e.dataset.fileLink!,
      ),
    ),
  ];
  const files = links.map((link): ViewerFile => ({
    source: 'workspace',
    ...base,
    ...fileLink(link),
  }));
  openFiles({ files, index: Math.max(0, links.indexOf(el.dataset.fileLink!)) });
}

export function viewerPath(file: ViewerFile) {
  return file.source === 'workspace' ? file.path : file.name;
}

export function viewerName(file: ViewerFile) {
  return viewerPath(file).split('/').pop()!;
}

export async function loadViewerFile(file: ViewerFile): Promise<FileContent> {
  if (file.source === 'workspace') return host.fs.read(file.root, file.path);
  const res = await fetch(file.url);
  if (!res.ok) throw new Error(`Could not read ${file.name}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // ponytail: a NUL in the first 8 KB means binary, git's heuristic; UTF-16 text reads as binary.
  if (bytes.subarray(0, 8000).includes(0))
    return { kind: 'binary', bytes, mtimeMs: 0 };
  return { kind: 'text', text: new TextDecoder().decode(bytes), mtimeMs: 0 };
}
