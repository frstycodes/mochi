import type {
  HookCallbackMatcher,
  HookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { MOCHI_SERVER } from '@mochi/domain/runtime/toolTable';

const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const GOAL_CALLS = ['get_goal', 'propose_goal'].map(
  (name) => `mcp__${MOCHI_SERVER}__${name}`,
);
// Writes made through the shell instead of Edit: in-place sed/perl, a redirect into a file, tee, git apply, a script fed by
// a heredoc. A heuristic: `->` in a string reads as a redirect (an early nudge), and a script writing from its own file is missed.
const SHELL_WRITE =
  /\b(sed|perl)\s+-\w*i|\btee\b|\bgit\s+apply\b|(^|[^\d&>])>{1,2}\s*(?!&|\/dev\/null)\S|\b(python3?|node)\s+-\s*<</;

export const NUDGE =
  "Mochi: you haven't read or proposed this thread's goal. Before this first edit, call mcp__mochi__get_goal; if there is none and the work has a checkable outcome, call mcp__mochi__propose_goal. Skip it for a small one-step change.";

/** Threads that read or proposed a goal, or were already nudged. In memory: after a Mochi restart a thread can be nudged once more. */
const done = new Set<string>();

/**
 * A PreToolUse matcher that reminds the agent to propose a goal at its first edit, once per thread. The goal instructions
 * alone get skipped on busy turns; this lands as context beside the edit, which still runs.
 */
export const goalNudge = (threadId: string): HookCallbackMatcher => ({
  hooks: [async (input) => nudgeOnce(threadId, input)],
});

export function nudgeOnce(threadId: string, input: HookInput) {
  if (
    input.hook_event_name !== 'PreToolUse' ||
    input.agent_id ||
    done.has(threadId)
  )
    return {};
  if (GOAL_CALLS.includes(input.tool_name)) {
    done.add(threadId);
    return {};
  }
  if (!isEdit(input.tool_name, input.tool_input)) return {};
  done.add(threadId);
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      additionalContext: NUDGE,
    },
  };
}

function isEdit(tool: string, input: unknown) {
  if (EDIT_TOOLS.includes(tool)) return true;
  const command =
    tool === 'Bash'
      ? (input as { command?: unknown } | null)?.command
      : undefined;
  return typeof command === 'string' && SHELL_WRITE.test(command);
}
