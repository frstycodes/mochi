import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpServerStatus } from '@anthropic-ai/claude-agent-sdk';
import { Effect, Option, Schema } from 'effect';
import { userData } from '../paths.ts';

/**
 * The claude.ai connectors each Claude account last reported, kept across restarts. Claude Code fetches them from the
 * account when a session starts, so no config file lists them; the library learns them from a session's
 * `mcpServerStatus()`. GAP: an account no Mochi thread has run on yet lists none.
 */
let known: Record<string, string[]> | null = null;
const file = () => join(userData(), 'claude-ai-connectors.json');
const decodeKnown = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Record(Schema.String, Schema.mutable(Schema.Array(Schema.String))),
  ),
);

async function load() {
  known ??= await readFile(file(), 'utf8').then(
    (text) => Option.getOrElse(decodeKnown(text), () => ({})),
    () => ({}),
  );
  return known;
}

export async function claudeAiConnectorsOf(
  accountId: string,
): Promise<string[]> {
  return (await load())[accountId] ?? [];
}

/** `denied`: the connectors this session left out, which its status can't list but the account still has. */
export async function recordClaudeAiConnectors(
  accountId: string,
  list: McpServerStatus[],
  denied: readonly string[],
) {
  const reported = list
    .filter((s) => s.config?.type === 'claudeai-proxy')
    .map((s) => s.name);
  // None at all is more likely a failed fetch, or an API-key session that skips them, than an account without any.
  if (!reported.length) return;
  const all = await load();
  const names = [...new Set([...reported, ...denied])].sort((a, b) =>
    a.localeCompare(b, 'en', { sensitivity: 'base' }),
  );
  if (names.join() === all[accountId]?.join()) return;
  all[accountId] = names;
  void writeFile(file(), JSON.stringify(all)).catch((error) =>
    Effect.runSync(
      Effect.logWarning('Could not save claude.ai connectors', error),
    ),
  );
}
