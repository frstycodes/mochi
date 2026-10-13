import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { State } from '../store/index.tsx';
import { queueReducer } from '../store/queue.ts';
import { initialThreads } from '../store/threads.ts';
import { applyAgentEvent } from './apply.ts';

const base = () => ({ ...initialThreads(undefined, true), queue: [], spaceId: 'latitude', views: {} }) as unknown as State;
const edit = (s: State, threadId: string, file: string, id: string) => {
  s = applyAgentEvent(s, { threadId, type: 'tool', id, phase: 'start', text: `Edit ${file}` });
  return applyAgentEvent(s, { threadId, type: 'tool', id, phase: 'end', text: `Edit ${file}`, files: [file], patch: `--- a/${file}\n+++ b/${file}\n@@\n+x` });
};

test('two live threads of one project editing the same file get one Queue item; Keep both clears it', () => {
  let s = base();
  const [a, b] = s.threads.filter((t) => t.repo?.project === 'latitude' && t.status !== 'settled');
  s = edit(s, a.id, 'apps/api/limits.ts', 't1');
  assert.equal(s.queue.filter((q) => q.kind === 'collision').length, 0, 'one thread alone');
  s = edit(s, b.id, 'apps/api/limits.ts', 't2');
  s = edit(s, b.id, 'apps/api/limits.ts', 't3');
  const items = s.queue.filter((q) => q.kind === 'collision');
  assert.equal(items.length, 1, 'once per pair');
  assert.deepEqual(items[0].collision, { otherThreadId: a.id, files: ['apps/api/limits.ts'] });
  s = queueReducer(s, { type: 'answer', queueId: items[0].id });
  assert.equal(s.queue.some((q) => q.kind === 'collision'), false);
});
