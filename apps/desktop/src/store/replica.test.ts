import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Thread } from '../model.ts';
import { createReplica, type ReplicaLog } from './replica.ts';
import { initialState } from './root.ts';
import type { Action } from './types.ts';

test('a stop reaches Core though it changes nothing in the projection', async () => {
  const sent: Action[] = [];
  const log: ReplicaLog = {
    follow: (_after, onItem) => {
      onItem({
        _tag: 'snapshot',
        sequence: 0,
        saved: null,
        context: null,
        parts: 0,
      });
      return () => {};
    },
    append: async ({ action }) => sent.push(action),
  };
  const replica = await createReplica(log, (saved) => ({
    ...initialState(saved),
    threads: [{ id: 't', live: { isWorking: true } } as Thread],
  }));

  replica.dispatch({ type: 'interrupt', threadId: 't' });
  await replica.sent();

  assert.deepEqual(sent, [{ type: 'interrupt', threadId: 't' }]);
});
