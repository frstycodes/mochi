import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MutationObserver, QueryObserver } from '@tanstack/react-query';
import { host } from '../host/index.ts';
import { queryClient } from '../query.ts';
import { libraryMutationOptions, libraryQuery } from './queries.ts';

test('library mutations refresh every mounted page and profile, including partial failures', async () => {
  const first = new QueryObserver(queryClient, libraryQuery('latitude'));
  const second = new QueryObserver(queryClient, libraryQuery('latitude'));
  const other = new QueryObserver(queryClient, libraryQuery('personal'));
  const stop = [first, second, other].map((observer) => observer.subscribe(() => {}));
  try {
    const entries = await queryClient.fetchQuery(libraryQuery('latitude'));
    await queryClient.fetchQuery(libraryQuery('personal'));
    const entry = entries[0];
    assert.ok(entry);
    const mutation = new MutationObserver(queryClient, libraryMutationOptions);
    await mutation.mutate(() => host.library.setEnabled('personal', entry.id, true));
    for (const page of [first, second, other]) assert.ok(page.getCurrentResult().data?.find((item) => item.id === entry.id)?.profileIds.includes('personal'));
    assert.strictEqual(first.getCurrentResult().data, second.getCurrentResult().data);

    await assert.rejects(mutation.mutate(async () => {
      await host.library.setEnabled('personal', entry.id, false);
      throw new Error('sign-in failed after saving');
    }), /sign-in failed/);
    for (const page of [first, second, other]) assert.equal(page.getCurrentResult().data?.find((item) => item.id === entry.id)?.profileIds.includes('personal'), false);
  } finally {
    stop.forEach((unsubscribe) => unsubscribe());
    queryClient.clear();
  }
});
