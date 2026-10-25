import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  createReadStream,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { it } from '@effect/vitest';
import { Deferred, Effect } from 'effect';
import {
  NO_PENDING_REQUEST,
  type AgentEvent,
} from '../../../../src/host/types/agent.ts';
import { UtilityQueue } from '../utility/queue.ts';
import { useAgentConfig } from './config.ts';
import { onAgentEvent } from './events.ts';
import { agent, disposeAgents, useAgentServices } from './handlers.ts';
import { useMain } from './main.ts';
import { setDataDir } from './paths.ts';
import { Turns } from './turns.ts';

// A fake `claude` speaking the stream-json control protocol the Agent SDK drives: it answers `initialize`, and on the first
// user message starts a long-lived child of its own (as Claude Code does for a shell or an MCP server) and asks to run a tool.
// The child holds the write end of the FIFO at FAKE_CHILD_FIFO, so the test sees it die as end-of-file.
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
      const child = spawn(process.execPath, ['-e', 'require("node:fs").openSync(process.env.FAKE_CHILD_FIFO, "w"); setInterval(() => {}, 1000)'], { stdio: 'ignore' });
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

// TODO(windows): the fake `claude` is a shebang script, which Windows can't run as an executable; it needs a `.cmd` shim.
it.live.skipIf(process.platform === 'win32')(
  'stopping a thread interrupts its session fiber, kills its Claude Code process tree and releases its pending approval',
  () =>
    Effect.gen(function* () {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'claude-fake-'));
      const fake = path.join(dir, 'claude');
      writeFileSync(fake, FAKE_CLAUDE, { mode: 0o755 });
      const pidFile = path.join(dir, 'child.pid');
      const fifo = path.join(dir, 'child.fifo');
      execFileSync('mkfifo', [fifo]);
      // Claude Code's env is `process.env` plus the account's (`accountEnv`), so the fake finds where to write.
      process.env.FAKE_CHILD_PID_FILE = pidFile;
      process.env.FAKE_CHILD_FIFO = fifo;
      setDataDir(dir);
      useAgentConfig({
        read: () => ({ harnesses: { claude: { path: fake } } }),
        write: async () => {},
        keychain: {
          isAvailable: async () => false,
          encrypt: async () => '',
          decrypt: async () => '',
        },
      });
      useMain(async (method) =>
        method === 'library'
          ? { servers: [], pluginDirs: [], connectors: [], rules: {} }
          : undefined,
      );
      const turns = yield* Turns.make;
      useAgentServices({ turns, queue: yield* UtilityQueue.make });
      const events: AgentEvent[] = [];
      const approvalSeen =
        yield* Deferred.make<Extract<AgentEvent, { type: 'approval' }>>();
      const off = onAgentEvent((event) => {
        events.push(event);
        if (event.type === 'approval')
          Deferred.doneUnsafe(approvalSeen, Effect.succeed(event));
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          off();
          disposeAgents();
        }),
      );

      yield* Effect.promise(() =>
        agent.start(undefined, 'stop-thread', {
          provider: 'claude',
          spaceId: 'space',
          cwd: dir,
          prompt: 'clean the build',
        }),
      );
      const approval = yield* Deferred.await(approvalSeen);
      const child = Number(readFileSync(pidFile, 'utf8'));
      assert.ok(
        isAlive(child),
        "Claude Code's child runs while the turn waits on the approval",
      );
      assert.ok(turns.isRunning('stop-thread'));
      // Opening the read end waits for the child's write end, so it is open before the stop can kill the child.
      const childPipe = createReadStream(fifo).resume();
      yield* Effect.promise(() => once(childPipe, 'open'));
      const childDied = once(childPipe, 'end');

      yield* Effect.promise(() => agent.stop(undefined, 'stop-thread'));

      assert.equal(turns.isRunning('stop-thread'), false);
      assert.ok(
        events.some(
          (e) => e.type === 'resolved' && e.requestId === approval.requestId,
        ),
        'the approval card is withdrawn',
      );
      yield* Effect.promise(() =>
        assert.rejects(
          agent.resolve(undefined, approval.requestId, { kind: 'allow' }),
          { message: NO_PENDING_REQUEST },
        ),
      );
      // End-of-file, not `isAlive`: the dead child can linger as a zombie until it is reaped.
      yield* Effect.promise(() => childDied);
    }),
);
