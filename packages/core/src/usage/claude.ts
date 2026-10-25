import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileRecords, jsonlFiles, type UsageRecord } from './records.ts';

/**
 * Claude Code's transcripts: `<configDir>/projects/<cwd with every non-alphanumeric as ->/…/*.jsonl`, one line per message.
 * Assistant lines carry the response's `usage`; subagent transcripts sit in the same folders.
 */
export async function claudeRecords(
  configDirs: string[],
  roots: string[],
  since: number | null,
): Promise<UsageRecord[]> {
  const prefixes = roots.map(encodeCwd);
  const dirs = (
    await Promise.all(
      configDirs.map(async (configDir) => {
        const projects = join(configDir, 'projects');
        const names = await readdir(projects).catch(() => []);
        // The folder name only narrows the search: a prefix also matches a sibling (`app` and `app2`), so the cwd on each line decides.
        return names
          .filter((name) => prefixes.some((p) => name.startsWith(p)))
          .map((name) => join(projects, name));
      }),
    )
  ).flat();
  const files = (
    await Promise.all(dirs.map((dir) => jsonlFiles(dir, since)))
  ).flat();
  return (
    await Promise.all(files.map((f) => fileRecords(f, parseClaudeLog)))
  ).flat();
}

export function encodeCwd(path: string) {
  return path.replace(/[^a-zA-Z0-9]/g, '-');
}

export async function parseClaudeLog(lines: AsyncIterable<string>) {
  const records: UsageRecord[] = [];
  for await (const line of lines) {
    const record = parseClaudeLine(line);
    if (record) records.push(record);
  }
  return records;
}

export function parseClaudeLine(line: string): UsageRecord | null {
  if (!line.includes('"usage"')) return null;
  let entry: ClaudeLine;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  const usage = entry.message?.usage;
  const model = entry.message?.model;
  // `<synthetic>` marks messages Claude Code wrote itself (an interrupted turn), never billed.
  if (
    !usage ||
    !model ||
    model === '<synthetic>' ||
    !entry.timestamp ||
    !entry.cwd
  )
    return null;
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return {
    key: entry.message?.id
      ? `claude\u0000${entry.message.id}\u0000${entry.requestId ?? ''}`
      : null,
    at: Date.parse(entry.timestamp),
    harness: 'claude',
    model,
    cwd: entry.cwd,
    sessionId: entry.sessionId ?? '',
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite5m: (usage.cache_creation_input_tokens ?? 0) - write1h,
    cacheWrite1h: write1h,
  };
}

interface ClaudeLine {
  timestamp?: string;
  cwd?: string;
  sessionId?: string;
  requestId?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
      };
    };
  };
}
