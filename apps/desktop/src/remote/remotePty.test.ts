import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vite-plus/test';
import { host } from '../host/index.ts';
import type { FollowedMachine, TerminalChunk } from '../host/types/remote.ts';
import { localPty } from '../terminal/sessions.ts';
import { ptyTransportFor, remotePty } from './remotePty.ts';

afterEach(() => vi.restoreAllMocks());

const machine = { id: 'm1', name: 'Studio' } as FollowedMachine;

test('a thread here gets this computer’s pty host; another computer’s gets one transport per machine', () => {
  assert.equal(ptyTransportFor({ kind: 'local' }), localPty);
  const remote = ptyTransportFor({ kind: 'remote', machine });
  assert.notEqual(remote, localPty);
  assert.equal(remote.id, 'machine:m1');
  assert.equal(ptyTransportFor({ kind: 'remote', machine }), remote);
  assert.notEqual(
    ptyTransportFor({ kind: 'remote', machine: { ...machine, id: 'm2' } }),
    remote,
  );
});

test('a remote shell opens, types in order, resizes and closes through the terminal commands', async () => {
  const sent: unknown[] = [];
  let release: () => void = () => {};
  const ask = vi.fn(async (command: { type: string }) => {
    sent.push(command);
    if (command.type === 'terminal-open') return { terminalId: 't1' };
    // The first write stays on its way until released, so later keystrokes batch behind it.
    if (
      sent.filter((c) => (c as { type: string }).type === 'terminal-write')
        .length === 1
    )
      await new Promise<void>((r) => (release = r));
    return undefined;
  });
  const pty = remotePty('m1', ask as never);
  const { id } = await pty.spawn({
    cwd: '/owner/path',
    threadId: 'm1~t-7',
    cols: 80,
    rows: 24,
    command: 'pnpm dev',
  });
  assert.equal(id, 't1');
  pty.write('t1', 'l');
  pty.write('t1', 's');
  release();
  await vi.waitFor(() => assert.equal(sent.length, 3));
  pty.resize('t1', 100, 30);
  pty.kill('t1');
  pty.write('t1', 'gone');
  await Promise.resolve();
  assert.deepEqual(sent, [
    { type: 'terminal-open', threadId: 'm1~t-7', cols: 80, rows: 24 },
    {
      type: 'terminal-write',
      threadId: 'm1~t-7',
      terminalId: 't1',
      data: 'pnpm dev\r',
    },
    {
      type: 'terminal-write',
      threadId: 'm1~t-7',
      terminalId: 't1',
      data: 'ls',
    },
    {
      type: 'terminal-resize',
      threadId: 'm1~t-7',
      terminalId: 't1',
      cols: 100,
      rows: 30,
    },
    { type: 'terminal-close', threadId: 'm1~t-7', terminalId: 't1' },
  ]);
});

test('only that machine’s output reaches its shells, with the exit', () => {
  let push: (chunk: TerminalChunk) => void = () => {};
  vi.spyOn(host.remote, 'onTerminalOutput').mockImplementation(
    (listener) => ((push = listener), () => {}),
  );
  const pty = remotePty('m1', vi.fn() as never);
  const events: unknown[] = [];
  pty.listen({
    data: (ptyId, data) => events.push(['data', ptyId, data]),
    exit: (ptyId, code) => events.push(['exit', ptyId, code]),
  });
  push({ machineId: 'm2', terminalId: 't1', data: 'other', next: 5 });
  push({ machineId: 'm1', terminalId: 't1', data: 'hi', next: 2 });
  push({ machineId: 'm1', terminalId: 't1', data: '', next: 2, exitCode: 0 });
  assert.deepEqual(events, [
    ['data', 't1', 'hi'],
    ['exit', 't1', 0],
  ]);
});
