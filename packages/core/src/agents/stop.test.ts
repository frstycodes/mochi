import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onTestFinished, test } from 'vite-plus/test';
import { Effect } from 'effect';
import { NO_PENDING_REQUEST, type AgentEvent } from '../../../../src/host/types/agent.ts';
import { UtilityQueue } from '../utility/queue.ts';
import { useAgentConfig } from './config.ts';
import { onAgentEvent } from './events.ts';
import { agent, disposeAgents, useAgentServices } from './handlers.ts';
import { useMain } from './main.ts';
import { setDataDir } from './paths.ts';
import { Turns } from './turns.ts';

// A fake `claude` speaking the stream-json control protocol the Agent SDK drives: it answers `initialize`, and on the first
// user message starts a long-lived child of its own (as Claude Code does for a shell or an MCP server) and asks to run a tool.
const FAKE_CLAUDE = String.raw`#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.300 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' })); process.exit(0); }
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
let buffer = '';
let asked = false;
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.type === 'control_request') {
      const response = message.request.subtype === 'initialize' ? { commands: [], models: [], account: {}, output_style: 'default', available_output_styles: [] } : {};
      send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response } });
    } else if (message.type === 'user' && !asked) {
      asked = true;
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      writeFileSync(process.env.FAKE_CHILD_PID_FILE, String(child.pid));
      send({ type: 'control_request', request_id: 'ask-1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'toolu_fake' } });
    }
  }
});
process.stdin.on('end', () => process.exit(0));
`;

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until<A>(read: () => A | undefined | false, what: string, timeoutMs = 15_000): Promise<A> {
  const startedAt = Date.now();
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// TODO(windows): the fake `claude` is a shebang script, which Windows can't run as an executable; it needs a `.cmd` shim.
test.skipIf(process.platform === 'win32')('stopping a thread interrupts its session fiber, kills its Claude Code process tree and releases its pending approval', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'claude-fake-'));
  const fake = path.join(dir, 'claude');
  writeFileSync(fake, FAKE_CLAUDE, { mode: 0o755 });
  const pidFile = path.join(dir, 'child.pid');
  // Claude Code's env is `process.env` plus the account's (`accountEnv`), so the fake finds where to write.
  process.env.FAKE_CHILD_PID_FILE = pidFile;
  setDataDir(dir);
  useAgentConfig({ read: () => ({ harnesses: { claude: { path: fake } } }), write: async () => {}, keychain: { isAvailable: async () => false, encrypt: async () => '', decrypt: async () => '' } });
  useMain(async (method) => (method === 'library' ? { servers: [], pluginDirs: [], connectors: [], rules: {} } : undefined));
  const turns = await Effect.runPromise(Turns.make);
  useAgentServices({ turns, queue: await Effect.runPromise(UtilityQueue.make) });
  const events: AgentEvent[] = [];
  const off = onAgentEvent((event) => events.push(event));
  onTestFinished(() => {
    off();
    disposeAgents();
  });

  await agent.start(undefined, 'stop-thread', { provider: 'claude', spaceId: 'space', cwd: dir, prompt: 'clean the build' });
  const approval = await until(() => events.find((e): e is Extract<AgentEvent, { type: 'approval' }> => e.type === 'approval'), 'the approval');
  const child = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(isAlive(child), "Claude Code's child runs while the turn waits on the approval");
  assert.ok(turns.isRunning('stop-thread'));

  await agent.stop(undefined, 'stop-thread');

  assert.equal(turns.isRunning('stop-thread'), false);
  assert.ok(events.some((e) => e.type === 'resolved' && e.requestId === approval.requestId), 'the approval card is withdrawn');
  await assert.rejects(agent.resolve(undefined, approval.requestId, { kind: 'allow' }), { message: NO_PENDING_REQUEST });
  await until(() => !isAlive(child), "Claude Code's child to die");
});
