import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Provider } from '../../src/model.ts';
import type { TokenBucket, UsageSession } from '../../src/host/types/usage.ts';
import { localDay } from '../../src/usage/days.ts';

/** One model response's tokens, as a harness log reported it. `input` excludes cache reads and writes. */
export interface UsageRecord {
  /** Same response logged twice (a resumed or forked session copies its history) shares a key; null when it can't repeat. */
  key: string | null;
  at: number;
  harness: Provider;
  model: string;
  cwd: string;
  sessionId: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

/** Parsed records per log file, reused while the file's size and mtime hold; a log only grows, so a change re-reads it whole. */
const parsed = new Map<string, { size: number; mtimeMs: number; records: UsageRecord[] }>();

export async function fileRecords(path: string, parse: (lines: AsyncIterable<string>) => Promise<UsageRecord[]>) {
  const info = await stat(path);
  const hit = parsed.get(path);
  if (hit && hit.size === info.size && hit.mtimeMs === info.mtimeMs) return hit.records;
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  const records = await parse(lines);
  parsed.set(path, { size: info.size, mtimeMs: info.mtimeMs, records });
  return records;
}

/** Every `.jsonl` under `dir` modified at or after `since`; none when the folder is missing. */
export async function jsonlFiles(dir: string, since: number | null): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => join(e.parentPath, e.name));
  if (since === null) return files;
  const fresh = await Promise.all(files.map(async (f) => ((await stat(f).catch(() => null))?.mtimeMs ?? 0) >= since));
  return files.filter((_, i) => fresh[i]);
}

/** The root a cwd belongs to: the longest one it is, or sits inside. */
export function rootOf(cwd: string, roots: string[]): string | null {
  let best: string | null = null;
  for (const root of roots) if ((cwd === root || cwd.startsWith(`${root}/`)) && root.length > (best?.length ?? -1)) best = root;
  return best;
}

/** Folds records into per-day, per-model, per-root buckets, keeping each response once and only those in a root since `since`. */
export function summarize(records: Iterable<UsageRecord>, roots: string[], since: number | null) {
  const buckets = new Map<string, TokenBucket>();
  const sessions = new Map<string, UsageSession>();
  const seen = new Set<string>();
  for (const r of records) {
    if (since !== null && r.at < since) continue;
    const root = rootOf(r.cwd, roots);
    if (!root) continue;
    if (r.key !== null) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
    }
    const day = localDay(r.at);
    const id = `${day}\u0000${r.harness}\u0000${r.model}\u0000${root}`;
    const b = buckets.get(id) ?? { day, harness: r.harness, model: r.model, root, input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
    b.input += r.input;
    b.output += r.output;
    b.cacheRead += r.cacheRead;
    b.cacheWrite5m += r.cacheWrite5m;
    b.cacheWrite1h += r.cacheWrite1h;
    buckets.set(id, b);
    sessions.set(`${r.harness}\u0000${r.sessionId}`, { harness: r.harness, root, id: r.sessionId });
  }
  return { tokens: [...buckets.values()], sessions: [...sessions.values()] };
}
