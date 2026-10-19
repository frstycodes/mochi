import type { HookCallbackMatcher, HookInput } from '@anthropic-ai/claude-agent-sdk';

const PR_CREATE = /\bgh\s+pr\s+create\b/;

/** Denies `gh pr create` in Bash: Mochi's `open_pr` writes the description, so the agent can't hand-write a long one. */
export async function denyPrCreate(input: HookInput) {
  const command = input.hook_event_name === 'PreToolUse' ? (input.tool_input as { command?: unknown } | null)?.command : undefined;
  if (typeof command !== 'string' || !PR_CREATE.test(command)) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      permissionDecision: 'deny' as const,
      permissionDecisionReason: 'Open the pull request with the mochi open_pr tool instead: give it a title and one line of why; Mochi pushes the branch and writes the description.',
    },
  };
}

/** PreToolUse matchers. */
export const PR_GUARD: HookCallbackMatcher[] = [{ matcher: 'Bash', hooks: [denyPrCreate] }];
