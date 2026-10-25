import type { AgentImage } from './agent.ts';
import type { Manifest } from './manifest.ts';

/** The saved threads as Core stores them: an index (`SavedIndex` JSON) and one `SavedThread` JSON per thread, shaped by `src/store/saved.ts`. */
export interface SavedFiles {
  index: string;
  threads: string[];
}

/** Replays and images. Threads are Core's: windows follow its `replica` stream (`src/store/replica.ts`). */
export interface DataHost {
  /** A thread's replay recording, JSON lines (`src/replay/record.ts`); null when it has none. */
  loadReplay(threadId: string): Promise<string | null>;
  /** Appends to the thread's recording; false once it reached its cap, after which main keeps only the one `capped` line it wrote. */
  appendReplay(threadId: string, lines: string): Promise<boolean>;
  replayUsage(): Promise<{ threads: number; bytes: number }>;
  /** Every recording, or only these threads'. */
  clearReplays(threadIds?: string[]): Promise<void>;
  /** Inlines `payload` (a `ReplayExport` as JSON) into the app's own single-file page and asks where to save it: the path, or null when cancelled. */
  exportReplay(payload: string, title: string): Promise<string | null>;
  /** Keeps an image you sent at full size: its file path (main's `userData/images`), or in the web build its data URL. */
  saveImage(
    mediaType: AgentImage['mediaType'],
    base64: string,
  ): Promise<string>;
}

/** Per thread; main refuses appends past it and writes one `capped` line. */
export const MAX_REPLAY_BYTES = 8 * 1024 * 1024;

export const dataMethods = {
  loadReplay: 'invoke',
  appendReplay: 'invoke',
  replayUsage: 'invoke',
  clearReplays: 'invoke',
  exportReplay: 'invoke',
  saveImage: 'invoke',
} satisfies Manifest<DataHost>;
