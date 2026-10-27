import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { KILL_REFUSED, KILL_WARNING, useAgentDriven } from '../processKill.ts';
import { guardKill } from './killGuard.ts';

const bash = (command: string) =>
  ({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: 't',
  }) as unknown as HookInput;

test('a pattern kill asks the user, refuses on an agent-driven turn (its delegated sessions too), and other commands pass', () => {
  useAgentDriven((threadId) => threadId === 'auto');
  assert.deepEqual(guardKill('a', bash('kill 4242')), {});
  assert.deepEqual(guardKill('a', bash('pkill -f x')).hookSpecificOutput, {
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason: KILL_WARNING,
  });
  for (const threadId of ['auto', 'auto--explore'])
    assert.deepEqual(
      guardKill(threadId, bash('killall node')).hookSpecificOutput,
      {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: KILL_REFUSED,
      },
    );
  useAgentDriven(() => false);
});
