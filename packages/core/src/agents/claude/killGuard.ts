import type {
  HookCallbackMatcher,
  HookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { killDecision } from '../processKill.ts';

/**
 * A PreToolUse matcher that stops a Bash call killing processes by name or pattern. A hook, not `canUseTool`: Claude Code skips
 * `canUseTool` in Full access and for pre-approved commands, but an `ask` from a hook still reaches it, as Mochi's approval card.
 * A pattern that reaches Mochi's own processes, or any pattern kill in an agent-driven turn (nobody to answer), is refused outright.
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
  if (decision.action === 'run') return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      permissionDecision:
        decision.action === 'ask' ? ('ask' as const) : ('deny' as const),
      permissionDecisionReason: decision.reason,
    },
  };
}
