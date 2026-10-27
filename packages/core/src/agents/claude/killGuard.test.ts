import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { test } from 'vite-plus/test';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { KILL_REFUSED, KILL_WARNING, useAgentDriven } from '../processKill.ts';
import { guardKill } from './killGuard.ts';

const call = (tool_name: string, tool_input: unknown) =>
  ({
    hook_event_name: 'PreToolUse',
    tool_name,
    tool_input,
    tool_use_id: 't',
  }) as unknown as HookInput;
const bash = (command: string) => call('Bash', { command });
// A pattern no process here matches, so these asks don't depend on what's running.
const NOBODY = 'zz-mochi-guard-nobody';

test('a pattern kill asks the user, refuses on an agent-driven turn (its delegated sessions too), and other calls pass', () => {
  useAgentDriven((threadId) => threadId === 'auto');
  assert.deepEqual(guardKill('a', bash('kill 4242')), {});
  assert.deepEqual(guardKill('a', bash('ls')), {});
  assert.deepEqual(guardKill('a', call('Read', { command: 'pkill node' })), {});
  assert.deepEqual(guardKill('a', bash(`pkill -f ${NOBODY}`)), {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: KILL_WARNING,
    },
  });
  for (const threadId of ['auto', 'auto--explore'])
    assert.deepEqual(guardKill(threadId, bash(`killall ${NOBODY}`)), {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: KILL_REFUSED,
      },
    });
  useAgentDriven(() => false);
});

test('a pattern that reaches Mochi itself is refused even on a turn the user started, naming it', () => {
  // The test runner is Core here: its own process is protected with no Claude Code process registered.
  for (const command of [
    `pkill ${basename(process.execPath)}`,
    `pkill -f ${NOBODY} .`,
    'kill -9 -1',
  ]) {
    const output = guardKill('a', bash(command)).hookSpecificOutput;
    assert.equal(output?.permissionDecision, 'deny', command);
    assert.match(
      output?.permissionDecisionReason ?? '',
      new RegExp(`^Mochi: refused\\..*Mochi itself \\(pid ${process.pid}\\)`),
    );
  }
});
