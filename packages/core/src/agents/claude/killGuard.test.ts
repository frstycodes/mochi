import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { DENY_REASON, guardKill, isBroadKill } from './killGuard.ts';

const LINES = [
  '/Users/me/.local/bin/claude --output-format stream-json --verbose --input-format stream-json --model=claude-opus-5-5 --permission-prompt-tool=stdio --resume=220ad438 --allowedTools=mcp__mochi__list_threads,mcp__mochi__create_thread,Bash(cat:*)',
];
const NAMES = ['claude', 'Electron'];
const broad = (command: string) => isBroadKill(command, LINES, NAMES);

test('kills that would reach Mochi’s Claude Code processes are broad', () => {
  const denied = [
    'pkill -f "cat" -n', // the incident: -n became a second pattern
    'pkill -f cat',
    'pkill -f -- stream-json',
    'pkill -9 -f claude',
    'pkill -fi CLAUDE',
    'pkill claude',
    'pkill clau',
    '/usr/bin/pkill -f mcp__mochi',
    'sudo pkill -f "input-format"',
    'cd x && pkill -f cat; echo done',
    'pkill -u me',
    'killall claude',
    'killall -9 claude',
    'killall -m cla',
    'killall -u me',
  ];
  denied.forEach((command) => assert.equal(broad(command), true, command));
});

test('specific kills, and commands that only mention the words, pass', () => {
  const allowed = [
    'pkill -f "vite --port 5173"',
    'pkill -f next-server',
    'pkill -x cat',
    'pkill -fx cat',
    'pkill -9 node',
    'pkill -u me -f "my-dev-server.js"',
    'killall node',
    'killall cat',
    'killall -m "^vite$"',
    'kill 1234',
    'echo "pkill -f cat"',
    'grep -rn killall src',
    'pgrep -fl cat',
  ];
  allowed.forEach((command) => assert.equal(broad(command), false, command));
});

test('the hook denies a broad Bash kill and ignores everything else', () => {
  const call = (tool_name: string, tool_input: unknown) =>
    ({
      hook_event_name: 'PreToolUse',
      tool_name,
      tool_input,
      tool_use_id: 't',
    }) as unknown as HookInput;
  // The test runner's own process (node) is protected even with no Claude Code process registered.
  assert.deepEqual(guardKill(call('Bash', { command: 'pkill node' })), {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: DENY_REASON,
    },
  });
  assert.deepEqual(guardKill(call('Bash', { command: 'ls' })), {});
  assert.deepEqual(guardKill(call('Read', { command: 'pkill node' })), {});
});
