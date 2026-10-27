import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'vite-plus/test';
import { commandsIn } from './processKill.ts';
import {
  describeHits,
  protect,
  protectedHits,
  protectedProcesses,
  type ProtectedProcess,
} from './protectedKill.ts';

// Fixtures, so nothing here depends on, or touches, the processes actually running.
const CLAUDE: ProtectedProcess = {
  line: '/Users/me/.local/bin/claude --output-format stream-json --verbose --input-format stream-json --model=claude-opus-5-5 --permission-prompt-tool=stdio --resume=220ad438 --allowedTools=mcp__mochi__list_threads,mcp__mochi__create_thread,Bash(cat:*)',
  name: 'claude',
  kind: 'claude',
  pid: () => 501,
};
const MOCHI: ProtectedProcess = {
  line: '/Applications/Mochi.app/Contents/MacOS/Electron --type=utility',
  name: 'Electron',
  kind: 'mochi',
  pid: () => 42,
};
const hits = (command: string) =>
  protectedHits(commandsIn(command), [CLAUDE, MOCHI]);

test.each([
  'pkill -f "cat" -n', // the incident: -n became a second pattern
  'pkill -f mochi-guard-test-nonexistent .', // `.` is a second pattern that matches everything
  'pkill -f cat',
  'pkill -f -- stream-json',
  'pkill -9 -f claude',
  'pkill -fi CLAUDE',
  'pkill claude',
  'pkill clau',
  '/usr/bin/pkill -f mcp__mochi',
  'sudo pkill -f "input-format"',
  'cd x && pkill -f cat; echo done',
  'sh -c "pkill -f stream-json"',
  'pkill -u me',
  'killall claude',
  'killall -9 claude',
  'killall -m cla',
  'killall -u me',
  'pgrep -f claude | xargs kill',
  'kill $(pgrep -f stream-json)',
])('reaches a protected process: %s', (command) =>
  assert.notDeepEqual(hits(command), []),
);

test.each([
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
  'pgrep -fl claude',
])('reaches none: %s', (command) => assert.deepEqual(hits(command), []));

test('a pattern names what it would kill', () => {
  assert.deepEqual(hits('killall Electron'), [MOCHI]);
  assert.equal(
    describeHits([MOCHI, CLAUDE, { ...CLAUDE, pid: () => 502 }]),
    'Mochi itself (pid 42) and 2 Claude Code sessions (pids 501, 502)',
  );
  assert.equal(describeHits([CLAUDE]), 'a Claude Code session (pid 501)');
});

test('a spawned process is protected until its exit, and Mochi always is', () => {
  const child = Object.assign(new EventEmitter(), { pid: 777 });
  protect('/opt/claude', ['--input-format', 'stream-json'], child);
  const live = protectedProcesses();
  assert.deepEqual(
    live.map((p) => [p.kind, p.pid()]),
    [
      ['claude', 777],
      ['mochi', process.pid],
    ],
  );
  child.emit('exit');
  assert.deepEqual(
    protectedProcesses().map((p) => p.kind),
    ['mochi'],
  );
});
