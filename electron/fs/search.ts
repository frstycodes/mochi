import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WebContents } from 'electron';
import type {
  SearchHits,
  SearchLine,
  SearchOptions,
  SearchSummary,
} from '../../src/host/types/fs.ts';
import { compileQuery, matchLines } from '../../src/files/search.ts';
import { isInside, resolveRoot } from './contain.ts';
import { listFiles } from './list.ts';

const MAX_MATCHES = 2_000;
const MAX_FILE_BYTES = 1024 * 1024;
const BINARY_SNIFF_BYTES = 8_000;
// Reads in flight at once: per-file latency (realpath, open), not throughput, is what a sequential walk waits on.
const READ_BATCH = 32;

interface SearchLimits {
  signal?: AbortSignal;
  maxMatches?: number;
  maxFileBytes?: number;
}

/** Matching lines in every listed file under `root`, one `onHits` call per file in path order; binary, oversized and escaping files are skipped. */
export async function searchFiles(
  root: string,
  pattern: string,
  options: SearchOptions,
  onHits: (path: string, lines: SearchLine[]) => void,
  {
    signal,
    maxMatches = MAX_MATCHES,
    maxFileBytes = MAX_FILE_BYTES,
  }: SearchLimits = {},
): Promise<SearchSummary> {
  const regex = compileQuery(pattern, options);
  const realRoot = await resolveRoot(root);
  const files = await listFiles(realRoot);
  let count = 0;
  for (let i = 0; i < files.length; i += READ_BATCH) {
    const batch = files.slice(i, i + READ_BATCH);
    const texts = await Promise.all(
      batch.map((file) => readText(realRoot, file, maxFileBytes)),
    );
    for (const [j, text] of texts.entries()) {
      if (signal?.aborted) return { isTruncated: false };
      if (count >= maxMatches) return { isTruncated: true };
      if (text === null) continue;
      const lines = matchLines(text, regex, maxMatches - count);
      if (!lines.length) continue;
      count += lines.length;
      onHits(batch[j], lines);
    }
  }
  return { isTruncated: false };
}

async function readText(realRoot: string, file: string, maxFileBytes: number) {
  try {
    const real = await realpath(path.join(realRoot, file));
    if (!isInside(realRoot, real)) return null;
    const info = await stat(real);
    if (!info.isFile() || info.size > maxFileBytes) return null;
    const bytes = await readFile(real);
    return bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)
      ? null
      : bytes.toString('utf8');
  } catch {
    // Deleted since listing, unreadable, or a symlink out of the root.
    return null;
  }
}

const running = new Map<string, AbortController>();

export async function searchFor(
  sender: WebContents,
  root: string,
  id: string,
  pattern: string,
  options: SearchOptions,
) {
  const controller = new AbortController();
  running.set(id, controller);
  const abort = () => controller.abort();
  sender.once('destroyed', abort);
  try {
    return await searchFiles(
      root,
      pattern,
      options,
      (path, lines) =>
        sender.isDestroyed() ||
        sender.send('fs:onSearchHits', {
          id,
          path,
          lines,
        } satisfies SearchHits),
      { signal: controller.signal },
    );
  } finally {
    running.delete(id);
    sender.off('destroyed', abort);
  }
}

export function cancelSearch(id: string) {
  running.get(id)?.abort();
}
