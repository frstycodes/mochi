import type { AgentLogin } from '../host/types/settings.ts';

/** `claude --version` prints `2.1.296 (Claude Code)`, `codex --version` prints `codex-cli 0.155.1`. */
export function parseVersion(stdout: string): string | null {
  return stdout.match(/\d+\.\d+\.\d+[\w.+-]*/)?.[0] ?? null;
}

// Values read from Claude Code 2.1.296's `auth status` source; anything newer falls through to the raw name.
const CLAUDE_METHODS: Record<string, string> = {
  'claude.ai': 'Claude account',
  api_key: 'API key',
  api_key_helper: 'API key helper',
  oauth_token: 'OAuth token',
  third_party: 'Cloud provider',
};

/** `claude auth status --json`. Reads only `loggedIn`, `authMethod`, `apiProvider` and `subscriptionType`; email and org stay behind. */
export function parseClaudeAuth(stdout: string): AgentLogin {
  let status: unknown;
  try {
    status = JSON.parse(stdout);
  } catch {
    return { state: 'unknown', reason: 'Claude Code printed something other than JSON' };
  }
  if (typeof status !== 'object' || status === null) return { state: 'unknown', reason: 'Unexpected auth status' };
  const { loggedIn, authMethod, apiProvider, subscriptionType } = status as Record<string, unknown>;
  if (loggedIn !== true || authMethod === 'none') return { state: 'logged-out' };
  const name = typeof authMethod === 'string' ? authMethod : 'unknown';
  const method = authMethod === 'third_party' && typeof apiProvider === 'string' ? `Cloud provider (${apiProvider})` : (CLAUDE_METHODS[name] ?? name);
  return { state: 'logged-in', method, plan: typeof subscriptionType === 'string' ? titleCase(subscriptionType) : undefined };
}

/** Codex app-server `account/read` result: `{ account: { type: 'chatgpt', planType } | { type: 'apiKey' } | null, requiresOpenaiAuth }`. */
export function parseCodexAccount(result: unknown): AgentLogin {
  if (typeof result !== 'object' || result === null) return { state: 'unknown', reason: 'Unexpected account/read result' };
  const { account, requiresOpenaiAuth } = result as Record<string, unknown>;
  if (account === null || account === undefined) return requiresOpenaiAuth === false ? { state: 'logged-in', method: 'No login needed' } : { state: 'logged-out' };
  if (typeof account !== 'object') return { state: 'unknown', reason: 'Unexpected account/read result' };
  const { type, planType } = account as Record<string, unknown>;
  const method = type === 'chatgpt' ? 'ChatGPT' : type === 'apiKey' ? 'API key' : String(type);
  return { state: 'logged-in', method, plan: typeof planType === 'string' ? titleCase(planType) : undefined };
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
