import { killDecision } from '../processKill.ts';
import type { RpcClient } from './rpc.ts';

/**
 * A PreToolUse hook that stops a Codex shell call killing processes by name or pattern. Codex runs it in every mode, Full access
 * too, and supports only `deny`, so there is no approval card: the agent is told to ask the user to run the command. The hook
 * POSTs its input to main's `kill-guard` loopback route (apps/desktop/electron/mcp/server.ts), which hands it to Core's
 * `agentKillHook`: `killHookAnswer` for the Mochi thread whose Codex session (`session_id`) ran it.
 *
 * The command never changes, so its trust hash doesn't either: the URL, with its per-launch port and secret, comes from the env.
 * Hooks from `-c` flags run only once trusted, and Codex reads trust only from the user config, so `trustKillGuard` writes this
 * one hook's hash there. It never uses `--dangerously-bypass-hook-trust`, which would also run the user's own untrusted hooks.
 */
export const KILL_GUARD_ENV = 'MOCHI_KILL_GUARD_URL';
export const KILL_GUARD_COMMAND = `curl -sS --max-time 5 --data-binary @- "$${KILL_GUARD_ENV}"`;

/** `codex app-server` flags that add the hook. */
export const killGuardFlags = () => [
  '-c',
  `hooks.PreToolUse=[{matcher="^Bash$",hooks=[{type="command",command=${JSON.stringify(KILL_GUARD_COMMAND)}}]}]`,
];

/** Codex can't ask, so a decision to ask is a deny too; the agent is told to ask the user instead. */
export const CANT_ASK =
  "Codex can't ask the user to approve it. If it's still needed, ask the user to run it themselves.";

/** The hook's stdout for a PreToolUse input from `threadId`'s agent: a deny when `killDecision` asks or refuses, nothing otherwise. */
export function killHookAnswer(threadId: string, input: unknown) {
  const { hook_event_name, tool_input } = (input ?? {}) as {
    hook_event_name?: unknown;
    tool_input?: { command?: unknown } | null;
  };
  if (hook_event_name !== 'PreToolUse') return null;
  const decision = killDecision(threadId, tool_input?.command);
  if (decision.action === 'run') return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        decision.action === 'ask'
          ? `${decision.reason} Blocked: ${CANT_ASK}`
          : decision.reason,
    },
  };
}

interface ListedHook {
  key: string;
  command?: string;
  source: string;
  currentHash: string;
  trustStatus: string;
}

/** Trusts the guard in this server's user config when it isn't yet; true once `hooks/list` reports it trusted. */
export async function trustKillGuard(rpc: RpcClient) {
  const guard = async () => {
    const listed = (await rpc.request('hooks/list', {})) as {
      data?: { hooks?: ListedHook[] }[];
    } | null;
    return listed?.data
      ?.flatMap((entry) => entry.hooks ?? [])
      .find(
        (hook) =>
          hook.source === 'sessionFlags' && hook.command === KILL_GUARD_COMMAND,
      );
  };
  const hook = await guard();
  if (!hook) return false;
  if (hook.trustStatus === 'trusted') return true;
  await rpc.request('config/value/write', {
    keyPath: 'hooks.state',
    mergeStrategy: 'upsert',
    value: { [hook.key]: { trusted_hash: hook.currentHash } },
  });
  return (await guard())?.trustStatus === 'trusted';
}
