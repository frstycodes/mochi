import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { NUDGE, NUDGE_AFTER, nudgeAfter } from './planNudge.ts';

const done = (tool_name: string, tool_response: unknown = '', extra = {}) =>
  ({
    hook_event_name: 'PostToolUse',
    tool_name,
    tool_input: {},
    tool_response,
    tool_use_id: 't',
    ...extra,
  }) as unknown as HookInput;
const context = (output: unknown) =>
  (output as { hookSpecificOutput?: { additionalContext?: string } })
    .hookSpecificOutput?.additionalContext;
const run = (thread: string, calls: number, tool = 'Bash') =>
  Array.from({ length: calls }, () => nudgeAfter(thread, done(tool)));

test('a run of calls without update_plan gets the reminder, then again after another run', () => {
  const first = run('a', NUDGE_AFTER);
  assert.equal(context(first.at(-1)), NUDGE);
  assert.ok(first.slice(0, -1).every((o) => context(o) === undefined));
  assert.equal(context(run('a', NUDGE_AFTER).at(-1)), NUDGE);
});

test('updating the plan restarts the count', () => {
  run('b', NUDGE_AFTER - 1);
  nudgeAfter('b', done('mcp__mochi__update_plan', 'Step 2/4 in progress'));
  assert.ok(run('b', NUDGE_AFTER - 1).every((o) => context(o) === undefined));
  assert.equal(context(run('b', 1)[0]), NUDGE);
});

test('a finished plan is left alone until the turn is reported', () => {
  nudgeAfter('c', done('mcp__mochi__update_plan', 'Plan done (4/4).'));
  assert.ok(run('c', NUDGE_AFTER * 2).every((o) => context(o) === undefined));
  nudgeAfter('c', done('mcp__mochi__report_turn'));
  assert.equal(context(run('c', NUDGE_AFTER).at(-1)), NUDGE);
});

test("a subagent's calls and other hook events don't count", () => {
  for (let i = 0; i < NUDGE_AFTER * 2; i++)
    assert.deepEqual(nudgeAfter('d', done('Bash', '', { agent_id: 's' })), {});
  assert.deepEqual(
    nudgeAfter('d', { hook_event_name: 'PreToolUse' } as HookInput),
    {},
  );
  assert.ok(run('d', NUDGE_AFTER - 1).every((o) => context(o) === undefined));
});
