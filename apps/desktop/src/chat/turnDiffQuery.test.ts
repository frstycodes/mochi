import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vite-plus/test';
import { host } from '../host/index.ts';
import { queryClient } from '../query.ts';
import type { RemoteIo } from '../remote/threadIo.ts';
import { turnDiffQuery } from './turnDiffQuery.ts';

const WORK = { kind: 'local', root: '/work' } as const;

afterEach(() => vi.restoreAllMocks());
afterEach(() => vi.useRealTimers());

test('turn diffs share checkpoint reads, retry failures, separate live boundaries and evict unused results', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const read = vi
    .spyOn(host.git, 'turnDiff')
    .mockImplementation(async () => []);
  const options = turnDiffQuery(WORK, 'before', 'after');
  try {
    await Promise.all([
      queryClient.fetchQuery(options),
      queryClient.fetchQuery(options),
    ]);
    assert.equal(read.mock.calls.length, 1);
    await queryClient.fetchQuery(options);
    assert.equal(read.mock.calls.length, 1);
    assert.notDeepEqual(
      turnDiffQuery(WORK, 'before', undefined, 3).queryKey,
      turnDiffQuery(WORK, 'before', undefined, 4).queryKey,
    );
    assert.equal(turnDiffQuery(null, 'before', 'after').enabled, false);
    assert.equal(turnDiffQuery(WORK, 'before', undefined).enabled, false);
    vi.advanceTimersByTime(options.gcTime!);
    assert.equal(queryClient.getQueryData(options.queryKey), undefined);
    read.mockImplementationOnce(async () => {
      throw new Error('git unavailable');
    });
    await assert.rejects(queryClient.fetchQuery(options), /git unavailable/);
    await queryClient.fetchQuery(options);
    assert.equal(read.mock.calls.length, 3);
  } finally {
    queryClient.clear();
  }
});

test('another computer’s turn diffs ask its owner, cached apart per machine, and wait while it’s offline', async () => {
  const io: RemoteIo = {
    kind: 'remote',
    machine: { id: 'm1', name: 'Studio', status: 'online', scopes: ['code'] },
    threadId: 'm1~t1',
  };
  const ask = vi.spyOn(host.remote, 'command').mockResolvedValue({
    isOk: true,
    data: { turnFiles: [] },
  });
  const local = vi.spyOn(host.git, 'turnDiff');
  try {
    const options = turnDiffQuery(io, 'abcd', 'beef');
    assert.deepEqual(await queryClient.fetchQuery(options), []);
    assert.deepEqual(ask.mock.calls[0], [
      'm1',
      { type: 'turn-diff', threadId: 't1', from: 'abcd', to: 'beef' },
    ]);
    assert.equal(local.mock.calls.length, 0);
    assert.notDeepEqual(
      options.queryKey,
      turnDiffQuery(WORK, 'abcd', 'beef').queryKey,
    );
    assert.equal(
      turnDiffQuery(
        { ...io, machine: { ...io.machine, status: 'offline' } },
        'abcd',
        'beef',
      ).enabled,
      false,
    );
  } finally {
    queryClient.clear();
  }
});
