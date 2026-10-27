import type {
  HookCallbackMatcher,
  HookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { KILL_REFUSED, KILL_WARNING, killDecision } from '../processKill.ts';

/**
 * A PreToolUse matcher that stops a Bash call killing processes by name or pattern. A hook, not `canUseTool`: Claude Code skips
 * `canUseTool` in Full access and for pre-approved commands, but an `ask` from a hook still reaches it, as Mochi's approval card.
 * An agent-driven turn has nobody to answer the card, so it is refused outright.
 */
export const killGuard = (threadId: string): HookCallbackMatcher => ({
  matcher: 'Bash',
  hooks: [async (input) => guardKill(threadId, input)],
});

export function guardKill(threadId: string, input: HookInput) {
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash')
    return {};
  const decision = killDecision(
    threadId,
    (input.tool_input as { command?: unknown } | null)?.command,
  );
  if (decision === 'run') return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      permissionDecision:
        decision === 'ask' ? ('ask' as const) : ('deny' as const),
      permissionDecisionReason:
        decision === 'ask' ? KILL_WARNING : KILL_REFUSED,
    },
  };
}
