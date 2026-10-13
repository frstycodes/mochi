import type { Manifest } from './manifest.ts';

/** The desktop app's saved threads: one JSON document in main's userData, shaped and parsed by the renderer (`src/store/persist.ts`). */
export interface DataHost {
  /** null when nothing was saved yet. */
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
  /** A thread's replay recording, JSON lines (`src/replay/record.ts`); null when it has none. */
  loadReplay(threadId: string): Promise<string | null>;
  /** Appends to the thread's recording; false once it reached its cap, after which main keeps only the one `capped` line it wrote. */
  appendReplay(threadId: string, lines: string): Promise<boolean>;
  replayUsage(): Promise<{ threads: number; bytes: number }>;
  /** Every recording, or only these threads'. */
  clearReplays(threadIds?: string[]): Promise<void>;
  /** Inlines `payload` (a `ReplayExport` as JSON) into the app's own single-file page and asks where to save it: the path, or null when cancelled. */
  exportReplay(payload: string, title: string): Promise<string | null>;
}

/** Per thread; main refuses appends past it and writes one `capped` line. */
export const MAX_REPLAY_BYTES = 8 * 1024 * 1024;

export const dataMethods = {
  load: 'invoke',
  save: 'invoke',
  loadReplay: 'invoke',
  appendReplay: 'invoke',
  replayUsage: 'invoke',
  clearReplays: 'invoke',
  exportReplay: 'invoke',
} satisfies Manifest<DataHost>;
