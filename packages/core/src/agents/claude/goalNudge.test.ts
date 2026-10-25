import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { NUDGE, nudgeOnce } from './goalNudge.ts';

const call = (tool_name: string, tool_input: unknown = {}, extra = {}) =>
  ({
    hook_event_name: 'PreToolUse',
    tool_name,
    tool_input,
    tool_use_id: 't',
    ...extra,
  }) as unknown as HookInput;
const bash = (command: string) => call('Bash', { command });
const context = (output: unknown) =>
  (
    output as {
      hookSpecificOutput?: {
        additionalContext?: string;
        permissionDecision?: string;
      };
    }
  ).hookSpecificOutput;

test('the first edit gets the nudge as context, not a deny, and only once per thread', () => {
  assert.deepEqual(nudgeOnce('a', call('Read')), {});
  assert.deepEqual(nudgeOnce('a', bash('git show HEAD 2>&1 | head')), {});
  const first = context(nudgeOnce('a', call('Edit')));
  assert.equal(first?.additionalContext, NUDGE);
  assert.equal(first?.permissionDecision, undefined);
  assert.deepEqual(nudgeOnce('a', call('Write')), {});
});

test('reading or proposing a goal first means no nudge', () => {
  assert.deepEqual(nudgeOnce('b', call('mcp__mochi__get_goal')), {});
  assert.deepEqual(nudgeOnce('b', call('Edit')), {});
});

test("a subagent's edit doesn't use up the thread's nudge", () => {
  assert.deepEqual(nudgeOnce('c', call('Edit', {}, { agent_id: 'sub' })), {});
  assert.equal(context(nudgeOnce('c', call('Edit')))?.additionalContext, NUDGE);
});

test('shell writes count as edits; reads and discarded output do not', () => {
  const writes = [
    "sed -i '' 's/a/b/' f.ts",
    'perl -pi -e s/a/b/ f',
    "python3 - <<'EOF'\nopen('f','w')\nEOF",
    'echo x > f.ts',
    'echo x >> f.ts',
    'cat a | tee f',
    'git apply p.diff',
  ];
  const reads = [
    'sed -n 1,20p f.ts',
    'pnpm typecheck >/dev/null 2>&1',
    'grep -rn foo src',
    'ls > /dev/null',
    'git log --oneline -5',
  ];
  writes.forEach((command, i) =>
    assert.equal(
      context(nudgeOnce(`w${i}`, bash(command)))?.additionalContext,
      NUDGE,
      command,
    ),
  );
  reads.forEach((command, i) =>
    assert.deepEqual(nudgeOnce(`r${i}`, bash(command)), {}, command),
  );
});
