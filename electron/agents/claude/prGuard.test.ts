import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { denyPrCreate } from './prGuard.ts';

const bash = (command: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, tool_use_id: 't' }) as unknown as HookInput;

test('gh pr create is denied with a pointer to open_pr; other commands pass', async () => {
  const denied = (await denyPrCreate(bash('git push && gh pr create --title x --body y'))) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
  assert.equal(denied.hookSpecificOutput?.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput!.permissionDecisionReason!, /open_pr/);
  assert.deepEqual(await denyPrCreate(bash('gh pr view 12')), {});
  assert.deepEqual(await denyPrCreate(bash('pnpm test')), {});
});
