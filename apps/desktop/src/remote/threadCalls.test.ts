import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { RemoteCommand } from '../host/types/remote.ts';
import { remoteCalls } from './threadCalls.ts';

test('another computer’s thread calls go to it as commands, by its machine-aware id', async () => {
  const sent: [string, RemoteCommand][] = [];
  const answers: Partial<Record<RemoteCommand['type'], unknown>> = {
    'pr-status': undefined,
    'disk-usage': { bytes: 5 },
    ports: { ports: [] },
  };
  const ask = (async (machineId: string, command: RemoteCommand) => {
    sent.push([machineId, command]);
    return answers[command.type];
  }) as Parameters<typeof remoteCalls>[2];
  const calls = remoteCalls('m1', 'm1~t', ask);

  assert.equal(calls.key, 'm1~t');
  assert.equal(await calls.pr(), null, 'no PR on its branch');
  assert.equal(await calls.diskUsage(), 5);
  await calls.prAct(3, { kind: 'comment', body: 'x' });
  await calls.killPort(42);
  await calls.sync();
  assert.deepEqual(sent, [
    ['m1', { type: 'pr-status', threadId: 'm1~t' }],
    ['m1', { type: 'disk-usage', threadId: 'm1~t' }],
    [
      'm1',
      {
        type: 'pr',
        threadId: 'm1~t',
        number: 3,
        action: { kind: 'comment', body: 'x' },
      },
    ],
    ['m1', { type: 'port-kill', threadId: 'm1~t', pid: 42 }],
    ['m1', { type: 'sync', threadId: 'm1~t' }],
  ]);
});
