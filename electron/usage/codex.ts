import { join } from 'node:path';
import { fileRecords, jsonlFiles, rootOf, type UsageRecord } from './records.ts';

// GAP: archived sessions (`<CODEX_HOME>/archived_sessions/*.jsonl.zst`) are compressed and left out until we read zstd.

/**
 * Codex's rollouts: `<CODEX_HOME>/sessions/YYYY/MM/DD/*.jsonl`. The first line is `session_meta` with the cwd; `turn_context`
 * names the model; each `token_count` event carries the running total and the last response's tokens.
 */
export async function codexRecords(homes: string[], roots: string[], since: number | null): Promise<UsageRecord[]> {
  const files = (await Promise.all(homes.map((home) => jsonlFiles(join(home, 'sessions'), since)))).flat();
  const all = await Promise.all(files.map((f) => fileRecords(f, parseCodexLog)));
  return all.filter((records) => records.length > 0 && rootOf(records[0].cwd, roots) !== null).flat();
}

export async function parseCodexLog(lines: AsyncIterable<string>) {
  const records: UsageRecord[] = [];
  let cwd = '';
  let sessionId = '';
  let model = '';
  let lastTotal = '';
  for await (const line of lines) {
    let entry: CodexLine;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const p = entry.payload;
    if (!p) continue;
    if (entry.type === 'session_meta') {
      cwd = p.cwd ?? '';
      sessionId = p.id ?? '';
    } else if (entry.type === 'turn_context') {
      model = p.model ?? model;
    } else if (entry.type === 'event_msg' && p.type === 'token_count' && p.info?.last_token_usage && entry.timestamp) {
      // Codex repeats the event with an unchanged total (rate-limit refreshes); only a new total is a new response.
      const total = JSON.stringify(p.info.total_token_usage);
      if (total === lastTotal) continue;
      lastTotal = total;
      const last = p.info.last_token_usage;
      const cached = last.cached_input_tokens ?? 0;
      records.push({
        key: null,
        at: Date.parse(entry.timestamp),
        harness: 'codex',
        model: model || 'unknown',
        cwd,
        sessionId,
        input: (last.input_tokens ?? 0) - cached,
        output: last.output_tokens ?? 0,
        cacheRead: cached,
        cacheWrite5m: last.cache_write_input_tokens ?? 0,
        cacheWrite1h: 0,
      });
    }
  }
  return records;
}

interface CodexLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    id?: string;
    cwd?: string;
    model?: string;
    info?: {
      total_token_usage?: unknown;
      last_token_usage?: { input_tokens?: number; cached_input_tokens?: number; cache_write_input_tokens?: number; output_tokens?: number };
    } | null;
  };
}
