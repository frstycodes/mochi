import { join } from 'node:path';
import {
  fileRecords,
  jsonlFiles,
  rootOf,
  type UsageRecord,
} from './records.ts';

/**
 * Codex's rollouts: `<CODEX_HOME>/sessions/YYYY/MM/DD/*.jsonl`, and the ones it archived, zstd-compressed, in
 * `archived_sessions/`. The first line is `session_meta` with the cwd; `turn_context` names the model; each `token_count`
 * event carries the running total and the last response's tokens.
 */
export async function codexRecords(
  homes: string[],
  roots: string[],
  since: number | null,
): Promise<UsageRecord[]> {
  const dirs = homes.flatMap((home) => [
    join(home, 'sessions'),
    join(home, 'archived_sessions'),
  ]);
  const files = (
    await Promise.all(dirs.map((dir) => jsonlFiles(dir, since)))
  ).flat();
  const all = await Promise.all(
    files.map((f) => fileRecords(f, parseCodexLog)),
  );
  return all
    .filter(
      (records) => records.length > 0 && rootOf(records[0].cwd, roots) !== null,
    )
    .flat();
}

/**
 * Newer rollouts log every model response as a `token_usage_record` with its `response_id`; the older `token_count` events
 * skip some (compactions among them), so they're only the fallback for rollouts that have no records. Only the file's own
 * thread counts: a subagent's rollout copies its parent's `session_meta` (and some history) after its own.
 */
export async function parseCodexLog(lines: AsyncIterable<string>) {
  const fromRecords: UsageRecord[] = [];
  const fromEvents: UsageRecord[] = [];
  let cwd: string | null = null;
  let sessionId = '';
  let model = '';
  let lastTotal = '';
  const usage = (
    at: string,
    key: string | null,
    u: TokenUsage,
  ): UsageRecord => {
    const cached = u.cached_input_tokens ?? 0;
    return {
      key,
      at: Date.parse(at),
      harness: 'codex',
      model: model || 'unknown',
      cwd: cwd ?? '',
      sessionId,
      input: (u.input_tokens ?? 0) - cached,
      output: u.output_tokens ?? 0,
      cacheRead: cached,
      cacheWrite5m: u.cache_write_input_tokens ?? 0,
      cacheWrite1h: 0,
    };
  };
  for await (const line of lines) {
    let entry: CodexLine;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const p = entry.payload;
    if (!p) continue;
    if (entry.type === 'session_meta' && cwd === null) {
      cwd = p.cwd ?? '';
      sessionId = p.id ?? '';
    } else if (entry.type === 'turn_context') {
      model = p.model ?? model;
    } else if (
      entry.type === 'token_usage_record' &&
      p.usage &&
      entry.timestamp &&
      p.thread_id === sessionId
    ) {
      fromRecords.push(
        usage(
          entry.timestamp,
          p.response_id ? `codex\u0000${p.response_id}` : null,
          p.usage,
        ),
      );
    } else if (
      entry.type === 'event_msg' &&
      p.type === 'token_count' &&
      p.info?.last_token_usage &&
      entry.timestamp
    ) {
      // Codex repeats the event with an unchanged total (rate-limit refreshes); only a new total is a new response.
      const total = JSON.stringify(p.info.total_token_usage);
      if (total === lastTotal) continue;
      lastTotal = total;
      fromEvents.push(usage(entry.timestamp, null, p.info.last_token_usage));
    }
  }
  return fromRecords.length > 0 ? fromRecords : fromEvents;
}

interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
}

interface CodexLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    id?: string;
    cwd?: string;
    model?: string;
    thread_id?: string;
    response_id?: string;
    usage?: TokenUsage;
    info?: {
      total_token_usage?: unknown;
      last_token_usage?: TokenUsage;
    } | null;
  };
}
