import { toast } from '../toast/store.ts';
import { host } from '../host/index.ts';
import { threadCwd } from '../host/cwd.ts';
import type { DiffFile } from '../host/types/git.ts';
import type { Thread } from '../model.ts';
import type { Checkpoint } from '../rewind/checkpoints.ts';
import type { State } from '../store/index.tsx';
import { demoRecording } from './demo.ts';
import {
  redactExport,
  type ExportedCheckpoint,
  type ReplayExport,
} from './export.ts';
import { parseRecording, type Recording } from './record.ts';
import { flushReplays } from './recorder.ts';

/** The thread's recording, including the second not yet written; a demo thread (never recorded) gets its scripted one. */
export async function loadRecording(thread: Thread): Promise<Recording | null> {
  if (!thread.live) return demoRecording(thread);
  await flushReplays();
  return parseRecording(await host.data.loadReplay(thread.id));
}

/** Where the replay reads the diff at a point: the thread's checkpoints whose files were saved (any in the web build's fixtures). */
export interface CheckpointSource {
  list: { at: number; label: string }[];
  files: (index: number) => Promise<DiffFile[]>;
}

export function liveCheckpoints(
  state: State,
  thread: Thread,
): CheckpointSource {
  const saved = (state.checkpoints[thread.id] ?? []).filter(
    (c) => c.ref || !host.isDesktop,
  );
  return { list: saved, files: (i) => checkpointFiles(thread, saved[i]) };
}

export function exportedCheckpoints(
  list: ExportedCheckpoint[],
): CheckpointSource {
  return { list, files: async (i) => list[i]?.files ?? [] };
}

/** One self-contained page with the recording and every checkpoint's diff, secrets redacted; the saved path, or null when cancelled. */
export async function exportReplay(
  state: State,
  thread: Thread,
): Promise<string | null> {
  const recording = await loadRecording(thread);
  if (!recording) throw new Error('Nothing was recorded for this thread yet');
  const { list, files } = liveCheckpoints(state, thread);
  const checkpoints = await Promise.all(
    list.map(async ({ at, label }, i) => ({
      at,
      label,
      files: await files(i).catch(() => []),
    })),
  );
  const payload: ReplayExport = redactExport({
    version: 1,
    recording,
    checkpoints,
  });
  return host.data.exportReplay(JSON.stringify(payload), thread.title);
}

/** `exportReplay` with its outcome as a toast (the thread menu, ⌘K, the replay page's button). */
export async function shareReplay(state: State, thread: Thread) {
  try {
    const saved = await exportReplay(state, thread);
    if (saved)
      toast('Replay exported', {
        description: `${saved}. Secrets in tool output are redacted; it opens in any browser, offline.`,
      });
  } catch (error) {
    toast.error('Couldn’t export the replay', {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

async function checkpointFiles(
  thread: Thread,
  checkpoint: Checkpoint | undefined,
) {
  if (!checkpoint) return [];
  return (
    await host.git.checkpointDiff(
      threadCwd(thread) ?? '.',
      thread.id,
      checkpoint.n,
    )
  ).files;
}
