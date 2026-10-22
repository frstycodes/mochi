import assert from 'node:assert/strict';
import { test } from 'node:test';
import { host } from '../host/index.ts';
import { queryClient } from '../query.ts';
import { turnDiffQuery } from './turnDiffQuery.ts';

test('turn diffs share checkpoint reads, retry failures, separate live boundaries and evict unused results', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const read = t.mock.method(host.git, 'turnDiff', async () => []);
  const options = turnDiffQuery('/work', 'before', 'after');
  try {
    await Promise.all([queryClient.fetchQuery(options), queryClient.fetchQuery(options)]);
    assert.equal(read.mock.callCount(), 1);
    await queryClient.fetchQuery(options);
    assert.equal(read.mock.callCount(), 1);
    assert.notDeepEqual(turnDiffQuery('/work', 'before', undefined, 3).queryKey, turnDiffQuery('/work', 'before', undefined, 4).queryKey);
    assert.equal(turnDiffQuery(null, 'before', 'after').enabled, false);
    assert.equal(turnDiffQuery('/work', 'before', undefined).enabled, false);
    t.mock.timers.tick(options.gcTime!);
    assert.equal(queryClient.getQueryData(options.queryKey), undefined);
    read.mock.mockImplementationOnce(async () => { throw new Error('git unavailable'); });
    await assert.rejects(queryClient.fetchQuery(options), /git unavailable/);
    await queryClient.fetchQuery(options);
    assert.equal(read.mock.callCount(), 3);
  } finally {
    queryClient.clear();
  }
});
