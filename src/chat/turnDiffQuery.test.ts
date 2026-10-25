import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vite-plus/test';
import { host } from '../host/index.ts';
import { queryClient } from '../query.ts';
import { turnDiffQuery } from './turnDiffQuery.ts';

afterEach(() => vi.restoreAllMocks());
afterEach(() => vi.useRealTimers());

test('turn diffs share checkpoint reads, retry failures, separate live boundaries and evict unused results', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const read = vi
    .spyOn(host.git, 'turnDiff')
    .mockImplementation(async () => []);
  const options = turnDiffQuery('/work', 'before', 'after');
  try {
    await Promise.all([
      queryClient.fetchQuery(options),
      queryClient.fetchQuery(options),
    ]);
    assert.equal(read.mock.calls.length, 1);
    await queryClient.fetchQuery(options);
    assert.equal(read.mock.calls.length, 1);
    assert.notDeepEqual(
      turnDiffQuery('/work', 'before', undefined, 3).queryKey,
      turnDiffQuery('/work', 'before', undefined, 4).queryKey,
    );
    assert.equal(turnDiffQuery(null, 'before', 'after').enabled, false);
    assert.equal(turnDiffQuery('/work', 'before', undefined).enabled, false);
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
