import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vite-plus/test';
import { host } from '../host/index.ts';
import type { FollowedMachine } from '../host/types/remote.ts';
import {
  askMachine,
  base64Blob,
  chooseThreadIo,
  remoteQuery,
} from './threadIo.ts';

afterEach(() => vi.restoreAllMocks());

const machine: FollowedMachine = {
  id: 'm1',
  name: 'Studio',
  status: 'online',
  scopes: ['read', 'code'],
};
const remote = { kind: 'remote', machine } as const;
const thread = {
  id: 'm1~t1',
  repo: { name: 'app', path: '/Users/x/app' },
} as unknown as Parameters<typeof chooseThreadIo>[0];

test('a thread here reads its own folder; another computer’s reads its owner, never a path here', () => {
  assert.deepEqual(chooseThreadIo(thread, { kind: 'local' }, '/work'), {
    kind: 'local',
    root: '/work',
  });
  assert.equal(chooseThreadIo(thread, { kind: 'local' }, null), null);
  assert.deepEqual(chooseThreadIo(thread, remote, '/work'), {
    kind: 'remote',
    machine,
    threadId: 'm1~t1',
  });
  assert.equal(
    chooseThreadIo({ ...thread, repo: null }, remote, null),
    null,
    'a folderless chat has nothing to read there either',
  );
  assert.deepEqual(
    chooseThreadIo(
      thread,
      { kind: 'remote', machine: { ...machine, scopes: ['read'] } },
      null,
    ),
    {
      kind: 'denied',
      reason: 'Studio hasn’t given this computer the code scope',
    },
  );
});

test('owner reads are keyed per machine and thread, and wait while it’s offline', () => {
  const io = chooseThreadIo(thread, remote, null);
  assert(io?.kind === 'remote');
  const options = remoteQuery(io, ['files'], async () => 1, 4000);
  assert.deepEqual(options.queryKey, ['machine-read', 'm1', 'm1~t1', 'files']);
  assert.equal(options.enabled, true);
  assert.equal(options.refetchInterval, 4000);
  const offline = {
    ...io,
    machine: { ...machine, status: 'offline' as const },
  };
  assert.equal(remoteQuery(offline, ['files'], async () => 1).enabled, false);
  assert.equal(
    remoteQuery({ kind: 'local', root: '/work' }, ['files'], async () => 1)
      .enabled,
    false,
  );
});

test('asking sends the thread’s own id and rejects with the machine’s reason', async () => {
  const command = vi
    .spyOn(host.remote, 'command')
    .mockResolvedValueOnce({
      isOk: true,
      data: { paths: ['a'], isTruncated: false },
    })
    .mockResolvedValueOnce({ isOk: false, error: 'No code scope' });
  assert.deepEqual(
    await askMachine('m1', { type: 'files', threadId: 'm1~t1' }),
    { paths: ['a'], isTruncated: false },
  );
  assert.deepEqual(command.mock.calls[0], [
    'm1',
    { type: 'files', threadId: 't1' },
  ]);
  await assert.rejects(
    askMachine('m1', { type: 'files', threadId: 'm1~t1' }),
    /No code scope/,
  );
});

test('a read-image answer decodes to its bytes with its type', async () => {
  const blob = base64Blob(btoa('\x89PNG\x00\xff'), 'image/png');
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(
    [...new Uint8Array(await blob.arrayBuffer())],
    [0x89, 0x50, 0x4e, 0x47, 0x00, 0xff],
  );
});
