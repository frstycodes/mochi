import assert from 'node:assert/strict';
import { test } from 'node:test';
import { singleLayout, splitLeaf, type View } from '../layout/tree.ts';
import type { Pane, QueueItem, Thread } from '../model.ts';
import { reviewThreads, stepIndex } from '../review/order.ts';
import type { State } from '../store/index.tsx';
import { available, scopeOf, splitByRule, when } from './when.ts';

const thread = (id: string, patch: Partial<Thread> = {}) => ({ id, spaceId: 's', status: 'running', repo: { project: 'p', branch: 'b' }, ...patch }) as Thread;
const review = (threadId: string, createdAt: number) => ({ id: `q-${threadId}`, kind: 'review', threadId, createdAt }) as QueueItem;

function state(view: View, threads: Thread[], queue: QueueItem[] = [], panes: Pane[] = []) {
  return { spaceId: 's', layouts: { s: singleLayout(view) }, threads, queue, panes, watched: [] } as unknown as State;
}

const pane = (threadId: string, patch: Partial<Pane> = {}): Pane => ({
  threadId,
  isOpen: true,
  tabs: [
    { id: 't1', kind: 'browser' },
    { id: 't2', kind: 'terminal' },
    { id: 't3', kind: 'browser' },
    { id: 't4', kind: 'files', isPopped: true },
  ],
  activeTab: 't2',
  ...patch,
});

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

const MENU = [
  { id: 'open', when: when.unfocusedThread },
  { id: 'watch', when: when.unwatched },
  { id: 'reveal', when: when.worktree },
  { id: 'close', when: when.tab },
  { id: 'others', when: when.otherTabs },
  { id: 'right', when: when.tabsToRight },
  { id: 'reload', when: when.browserTab },
  { id: 'pop', when: when.poppableTab },
];
const menu = (s: State, target = {}, isDesktop = false) => available(MENU, scopeOf(s, target, isDesktop)).map((a) => a.id);

test('a right-clicked row targets its own thread, not the focused one, and offers Open', () => {
  const s = state({ kind: 'thread', id: 'a' }, [thread('a'), thread('b', { title: 'B' })]);
  const scope = scopeOf(s, { threadId: 'b' });
  assert.equal(scope.thread?.id, 'b');
  assert.equal(scope.isFocused, false);
  assert.deepEqual(menu(s, { threadId: 'b' }), ['open', 'watch']);
  assert.ok(!menu(s, { threadId: 'a' }).includes('open'), 'the focused thread is already open');
});

test('a row target never picks up the pane tab, so tab actions stay out of thread menus', () => {
  const s = state({ kind: 'thread', id: 'a' }, [thread('a'), thread('b')], [], [pane('b')]);
  assert.equal(scopeOf(s, { threadId: 'b' }).tab, undefined);
  assert.equal(scopeOf(s, { threadId: 'b', tabId: 't1' }).tab?.id, 't1');
});

test('reveal needs the desktop app and a repo', () => {
  const s = state({ kind: 'thread', id: 'a' }, [thread('a'), thread('n', { repo: null })]);
  assert.ok(menu(s, {}, true).includes('reveal'));
  assert.ok(!menu(s, {}, false).includes('reveal'));
  assert.ok(!menu(s, { threadId: 'n' }, true).includes('reveal'));
});

test('watched threads offer stop watching instead', () => {
  const s = state({ kind: 'thread', id: 'a' }, [thread('a')]);
  (s as { watched: string[] }).watched = ['a'];
  assert.ok(!menu(s).includes('watch'));
  assert.equal(scopeOf(s).isWatched, true);
});

test('tab menus: close others and close to the right count docked tabs of the same pane only; browser tabs cannot pop out', () => {
  const s = state({ kind: 'thread', id: 'a' }, [thread('a')], [], [pane('a')]);
  assert.deepEqual(scopeOf(s, { threadId: 'a', tabId: 't1' }).tabs.map((t) => t.id), ['t1', 't3']);
  assert.deepEqual(menu(s, { threadId: 'a', tabId: 't1' }), ['watch', 'close', 'others', 'right', 'reload']);
  assert.deepEqual(menu(s, { threadId: 'a', tabId: 't2' }), ['watch', 'close', 'pop']);
  assert.deepEqual(menu(s, { threadId: 'a', tabId: 't4' }), ['watch', 'close', 'pop'], 'a popped tab has no pane neighbours');
});

test('the palette scopes to the open pane\'s active tab; a closed pane offers no tab actions', () => {
  const open = state({ kind: 'thread', id: 'a' }, [thread('a')], [], [pane('a')]);
  assert.equal(scopeOf(open).tab?.id, 't2');
  const closed = state({ kind: 'thread', id: 'a' }, [thread('a')], [], [pane('a', { isOpen: false })]);
  assert.equal(scopeOf(closed).tab, undefined);
});

test('a split header targets that split and its thread; the focused split stays focused', () => {
  const s = state({ kind: 'thread', id: 'a' }, [thread('a'), thread('b')]);
  const layout = s.layouts.s;
  const split = splitLeaf(layout.root, layout.focusId, { kind: 'thread', id: 'b' }, 'right');
  s.layouts.s = { ...layout, root: split.root };
  const scope = scopeOf(s, { leafId: split.leafId });
  assert.equal(scope.leafId, split.leafId);
  assert.equal(scope.thread?.id, 'b');
  assert.equal(scope.isFocused, false);
  assert.equal(scopeOf(s).leafId, layout.focusId);
});

test('bulk: a rule splits the selected threads into those it applies to and those it skips', () => {
  const s = state({ kind: 'thread', id: 'a' }, [thread('a', { orbitSlot: 1 }), thread('b'), thread('c', { status: 'settled' })]);
  const scopes = ['a', 'b', 'c'].map((threadId) => scopeOf(s, { threadId }));
  const ids = (list: { thread?: Thread }[]) => list.map((x) => x.thread?.id);
  const pin = splitByRule(when.unpinned, scopes);
  assert.deepEqual([ids(pin.applies), ids(pin.skipped)], [['b'], ['a', 'c']]);
  assert.deepEqual(ids(splitByRule(when.liveThread, scopes).skipped), ['c']);
  assert.deepEqual(splitByRule(undefined, scopes).skipped, []);
});
