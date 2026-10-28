import type {
  HookCallbackMatcher,
  HookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { MOCHI_SERVER } from '@mochi/domain/runtime/toolTable';

const PLAN_CALL = `mcp__${MOCHI_SERVER}__update_plan`;
const REPORT_CALL = `mcp__${MOCHI_SERVER}__report_turn`;

/** Tool calls without an update_plan before the reminder, and again after each further run of this many. */
export const NUDGE_AFTER = 6;

export const NUDGE =
  'Mochi: your plan has not been updated for a while. If a step finished or the next one just began, call mcp__mochi__update_plan with {"advance": true} (or {"items": [...]} to resend the whole plan) in your next message. Ignore this if the plan is current or this request needs none.';

/** Per thread: calls since the plan was last touched, and whether it reported done. In memory: a Mochi restart starts the count over. */
const threads = new Map<string, { calls: number; isDone: boolean }>();

/**
 * A PostToolUse matcher that reminds the agent to keep `update_plan` current. Claude Code nudges its own task tools after a
 * stretch of turns without them; Mochi turns those tools off, so the nudge went with them, and the instructions alone
 * were not enough for Sonnet (it sent the first plan, then never advanced it). This restores it as context beside a result.
 */
export const planNudge = (threadId: string): HookCallbackMatcher => ({
  hooks: [async (input) => nudgeAfter(threadId, input)],
});

export function nudgeAfter(threadId: string, input: HookInput) {
  if (input.hook_event_name !== 'PostToolUse' || input.agent_id) return {};
  const state = threads.get(threadId) ?? { calls: 0, isDone: false };
  threads.set(threadId, state);
  if (input.tool_name === REPORT_CALL) {
    state.calls = 0;
    state.isDone = false;
    return {};
  }
  if (input.tool_name === PLAN_CALL) {
    state.calls = 0;
    state.isDone = JSON.stringify(input.tool_response).includes('Plan done');
    return {};
  }
  if (state.isDone || ++state.calls < NUDGE_AFTER) return {};
  state.calls = 0;
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse' as const,
      additionalContext: NUDGE,
    },
  };
}
