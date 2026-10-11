import assert from 'node:assert/strict';
import { test } from 'node:test';
import { singleLayout, splitLeaf, type View } from '../layout/tree.ts';
import type { QueueItem, Thread } from '../model.ts';
import { reviewThreads, stepIndex } from '../review/order.ts';
import type { State } from '../store/index.tsx';
import { available, scopeOf, when } from './when.ts';

const thread = (id: string, patch: Partial<Thread> = {}) => ({ id, spaceId: 's', status: 'running', repo: { project: 'p', branch: 'b' }, ...patch }) as Thread;
const review = (threadId: string, createdAt: number) => ({ id: `q-${threadId}`, kind: 'review', threadId, createdAt }) as QueueItem;

function state(view: View, threads: Thread[], queue: QueueItem[] = []) {
  return { spaceId: 's', layouts: { s: singleLayout(view) }, threads, queue } as unknown as State;
}

const ACTIONS = [
  { id: 'queue' },
  { id: 'settle', when: when.liveThread },
  { id: 'reactivate', when: when.settledThread },
  { id: 'pin', when: when.unpinned },
  { id: 'unpin', when: when.pinned },
  { id: 'dev', when: when.repo },
  { id: 'close-split', when: when.splits },
  { id: 'review', when: when.reviews },
  { id: 'space-s', when: when.otherSpace('s') },
  { id: 'space-t', when: when.otherSpace('t') },
];
const ids = (s: State) => available(ACTIONS, scopeOf(s)).map((a) => a.id);

test('no focused thread: only global actions', () => {
  assert.deepEqual(ids(state({ kind: 'queue' }, [thread('a')])), ['queue', 'space-t']);
});

test('focused running thread offers settle and pin, not reactivate', () => {
  assert.deepEqual(ids(state({ kind: 'thread', id: 'a' }, [thread('a')])), ['queue', 'settle', 'pin', 'dev', 'space-t']);
});

test('pinned thread offers unpin; settled thread offers only reactivate', () => {
  assert.ok(ids(state({ kind: 'thread', id: 'a' }, [thread('a', { orbitSlot: 1 })])).includes('unpin'));
  const settled = ids(state({ kind: 'thread', id: 'a' }, [thread('a', { status: 'settled', orbitSlot: 1 })]));
  assert.ok(settled.includes('reactivate') && !settled.includes('settle') && !settled.includes('unpin'));
});

test('a pane tab dragged into a split counts as its thread; chats without a folder hide repo actions', () => {
  assert.ok(ids(state({ kind: 'tab', threadId: 'a', tabId: 't1' }, [thread('a', { repo: null })])).includes('settle'));
  assert.ok(!ids(state({ kind: 'thread', id: 'a' }, [thread('a', { repo: null })])).includes('dev'));
});

test('split actions need two splits; review needs a thread in review', () => {
  const s = state({ kind: 'queue' }, [thread('a', { status: 'review' })]);
  const layout = s.layouts.s;
  s.layouts.s = { ...layout, root: splitLeaf(layout.root, layout.focusId, { kind: 'board' }, 'right').root };
  assert.deepEqual(ids(s), ['queue', 'close-split', 'review', 'space-t']);
});

test('review order: oldest request first, other spaces and non-review threads left out', () => {
  const threads = [thread('new', { status: 'review' }), thread('old', { status: 'review' }), thread('busy'), thread('away', { status: 'review', spaceId: 't' }), thread('unqueued', { status: 'review' })];
  const queue = [review('new', 30), review('old', 10), review('away', 1)];
  assert.deepEqual(reviewThreads({ threads, queue, spaceId: 's' }).map((t) => t.id), ['old', 'new', 'unqueued']);
});

test('review navigation wraps both ways and survives an empty list', () => {
  assert.equal(stepIndex(2, 3, 1), 0);
  assert.equal(stepIndex(0, 3, -1), 2);
  assert.equal(stepIndex(0, 0, 1), 0);
});
