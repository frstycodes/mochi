import type { DiffFile } from '../host/types/git.ts';
import { redactSecrets } from '../settings/agentConfig.ts';
import type { Recording } from './record.ts';
import { PAYLOAD_ID } from './page.ts';

/** A shared replay: the recording and the checkpoint diffs it scrubs through, inlined into the app's own single-file page. */
export interface ReplayExport {
  version: 1;
  recording: Recording;
  checkpoints: ExportedCheckpoint[];
}

export interface ExportedCheckpoint {
  at: number;
  label: string;
  files: DiffFile[];
}

/** Every string in the export goes through `redactSecrets`, so a token a tool printed (or you pasted) never leaves the machine. */
export function redactExport<T>(value: T): T {
  if (typeof value === 'string') return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map(redactExport) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactExport(v)]),
    ) as T;
  return value;
}

/** A page built by `embedReplay` (the app reads this before mounting the store). */
export function readEmbeddedReplay(): ReplayExport | null {
  if (typeof document === 'undefined') return null;
  const text = document.getElementById(PAYLOAD_ID)?.textContent;
  if (!text) return null;
  try {
    const payload = JSON.parse(text) as ReplayExport;
    return payload?.version === 1 && payload.recording?.base ? payload : null;
  } catch {
    return null;
  }
}
