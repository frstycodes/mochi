import { createReadStream } from 'node:fs';
import * as zlib from 'node:zlib';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { cached } from '../cache.ts';
import type { Provider } from '../../src/model.ts';
import type { TokenBucket, UsageSession } from '../../src/host/types/usage.ts';
import { localDay } from '../../src/usage/days.ts';
import { responseCost, uncachedCost, type PriceBook } from './prices.ts';

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

// Parsed records per log file; the key carries size and mtime, so a log that grew is re-read whole.
const RECORDS_TTL = '1 hour';

export async function fileRecords(
  path: string,
  parse: (lines: AsyncIterable<string>) => Promise<UsageRecord[]>,
) {
  const info = await stat(path);
  return cached(`usage:${path}:${info.size}:${info.mtimeMs}`, RECORDS_TTL, () =>
    readRecords(path, parse),
  );
}

async function readRecords(
  path: string,
  parse: (lines: AsyncIterable<string>) => Promise<UsageRecord[]>,
) {
  const isZstd = path.endsWith('.zst');
  // Codex compresses archived rollouts with zstd, which Node's zlib reads from 22.15; an older runtime skips them.
  if (isZstd && typeof zlib.createZstdDecompress !== 'function') return [];
  const file = createReadStream(path);
  const input = isZstd ? file.pipe(zlib.createZstdDecompress()) : file;
  const lines = createInterface({
    input: input.setEncoding('utf8'),
    crlfDelay: Infinity,
  });
  return parse(lines);
}

/** Every `.jsonl` (or zstd `.jsonl.zst`) under `dir` modified at or after `since`; none when the folder is missing. */
export async function jsonlFiles(
  dir: string,
  since: number | null,
): Promise<string[]> {
  const entries = await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);
  const files = entries
    .filter((e) => e.isFile() && /\.jsonl(\.zst)?$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
  if (since === null) return files;
  const fresh = await Promise.all(
    files.map(
      async (f) => ((await stat(f).catch(() => null))?.mtimeMs ?? 0) >= since,
    ),
  );
  return files.filter((_, i) => fresh[i]);
}

/** The root a cwd belongs to: the longest one it is, or sits inside (`/` takes every folder). */
export function rootOf(cwd: string, roots: string[]): string | null {
  let best: string | null = null;
  for (const root of roots)
    if (
      (cwd === root || cwd.startsWith(root === '/' ? '/' : `${root}/`)) &&
      root.length > (best?.length ?? -1)
    )
      best = root;
  return best;
}

/**
 * Folds records into per-day, per-model, per-root buckets priced response by response, keeping only those in a root since
 * `since`. A response logged on several lines (Claude Code streams it: the first lines carry a partial output count) counts
 * once, with its final, largest counts.
 */
export function summarize(
  records: Iterable<UsageRecord>,
  roots: string[],
  since: number | null,
  price: PriceBook,
) {
  const buckets = new Map<string, TokenBucket>();
  const sessions = new Map<string, UsageSession>();
  for (const r of latest(records)) {
    if (since !== null && r.at < since) continue;
    const root = rootOf(r.cwd, roots);
    if (!root) continue;
    const day = localDay(r.at);
    const id = `${day}\u0000${r.harness}\u0000${r.model}\u0000${root}`;
    const rates = price(r.model);
    const b = buckets.get(id) ?? {
      day,
      harness: r.harness,
      model: r.model,
      root,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cost: rates && { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      uncached: rates && 0,
    };
    b.input += r.input;
    b.output += r.output;
    b.cacheRead += r.cacheRead;
    b.cacheWrite5m += r.cacheWrite5m;
    b.cacheWrite1h += r.cacheWrite1h;
    if (rates && b.cost && b.uncached !== null) {
      const c = responseCost(r, rates);
      b.cost.input += c.input;
      b.cost.output += c.output;
      b.cost.cacheRead += c.cacheRead;
      b.cost.cacheWrite += c.cacheWrite;
      b.uncached += uncachedCost(r, rates);
    }
    buckets.set(id, b);
    sessions.set(`${r.harness}\u0000${r.sessionId}`, {
      harness: r.harness,
      root,
      id: r.sessionId,
    });
  }
  return { tokens: [...buckets.values()], sessions: [...sessions.values()] };
}

/** Each keyed response once, with the largest of every count its lines reported. */
function latest(records: Iterable<UsageRecord>) {
  const byKey = new Map<string, UsageRecord>();
  const unkeyed: UsageRecord[] = [];
  for (const r of records) {
    if (r.key === null) {
      unkeyed.push(r);
      continue;
    }
    const prev = byKey.get(r.key);
    byKey.set(
      r.key,
      prev
        ? {
            ...prev,
            input: Math.max(prev.input, r.input),
            output: Math.max(prev.output, r.output),
            cacheRead: Math.max(prev.cacheRead, r.cacheRead),
            cacheWrite5m: Math.max(prev.cacheWrite5m, r.cacheWrite5m),
            cacheWrite1h: Math.max(prev.cacheWrite1h, r.cacheWrite1h),
          }
        : r,
    );
  }
  return [...byKey.values(), ...unkeyed];
}
