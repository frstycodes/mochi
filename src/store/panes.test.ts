import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pane } from '../model.ts';
import type { State } from './index.tsx';
import { panesReducer, shownTab } from './panes.ts';

const pane = (rest: Partial<Pane> = {}): Pane => ({
  threadId: 't',
  isOpen: true,
  activeTab: 'a',
  tabs: [
    { id: 'a', kind: 'browser' },
    { id: 'b', kind: 'changes' },
    { id: 'c', kind: 'terminal' },
  ],
  layout: { columns: [['browser', 'changes', 'terminal']], focused: 'browser' },
  ...rest,
});
const run = (p: Pane | undefined, ...actions: Parameters<typeof panesReducer>[1][]) =>
  actions.reduce((s, a) => panesReducer(s, a), { panes: p ? [p] : [], threads: [] } as unknown as State).panes[0];

test('opening a kind opens its pane below the focused one and focuses it', () => {
  const p = run(undefined, { type: 'pane-open-tab', threadId: 't', kind: 'files' }, { type: 'pane-open-tab', threadId: 't', kind: 'ports' });
  assert.deepEqual(p.tabs.map((t) => t.kind), ['files', 'ports']);
  assert.deepEqual(p.layout?.columns, [['files', 'ports']]);
  assert.deepEqual([p.isOpen, p.activeTab, p.layout?.focused], [true, p.tabs[1].id, 'ports']);
});

test('a kind opens at most once per thread; a Files pane switches to the file asked for', () => {
  const p = run(undefined, { type: 'pane-open-tab', threadId: 't', kind: 'files', file: { path: 'src/a.ts' } }, { type: 'pane-open-tab', threadId: 't', kind: 'files', file: { path: 'src/b.ts', line: 4 } });
  assert.equal(p.tabs.length, 1);
  assert.deepEqual([p.tabs[0].file, p.tabs[0].title], [{ path: 'src/b.ts', line: 4 }, 'b.ts']);
});

test('Preview keeps several tabs in one pane and shows the newest', () => {
  const p = run(pane(), { type: 'pane-open-tab', threadId: 't', kind: 'browser', url: 'localhost:5173' });
  assert.equal(p.tabs.filter((t) => t.kind === 'browser').length, 2);
  assert.equal(shownTab(p, 'browser')?.url, 'localhost:5173');
  assert.deepEqual(p.layout?.columns, [['browser', 'changes', 'terminal']]);
});

test('closing a Preview tab shows its right neighbour, then its left; closing the last one closes the pane', () => {
  const p = run(pane(), { type: 'pane-open-tab', threadId: 't', kind: 'browser' }, { type: 'pane-select-tab', threadId: 't', tabId: 'a' }, { type: 'pane-close-tab', threadId: 't', tabId: 'a' });
  assert.equal(shownTab(p, 'browser')?.id, 'tab-1');
  const gone = run(p, { type: 'pane-close-tab', threadId: 't', tabId: 'tab-1' });
  assert.deepEqual(gone.layout?.columns, [['changes', 'terminal']]);
  const empty = run(pane(), ...['a', 'b', 'c'].map((tabId) => ({ type: 'pane-close-tab' as const, threadId: 't', tabId })));
  assert.deepEqual([empty.isOpen, empty.activeTab, empty.layout?.columns], [false, '', []]);
});

test('closing a pane keeps its tab, so it comes back as it was', () => {
  const closed = run(pane(), { type: 'pane-close-kind', threadId: 't', kind: 'terminal' });
  assert.deepEqual(closed.layout?.columns, [['browser', 'changes']]);
  assert.equal(closed.tabs.length, 3);
  const back = run(closed, { type: 'pane-show-tab', threadId: 't', kind: 'terminal' });
  assert.equal(back.tabs.length, 3);
  assert.deepEqual([back.layout?.focused, back.activeTab], ['terminal', 'c']);
});

test('reorder follows the given order and keeps unlisted tabs after it', () => {
  const p = run(pane(), { type: 'pane-reorder', threadId: 't', order: ['c', 'a'] });
  assert.deepEqual(p.tabs.map((t) => t.id), ['c', 'a', 'b']);
});

test('popping a pane out closes it in the layout, putting it back opens and focuses it', () => {
  const popped = run(pane({ activeTab: 'b' }), { type: 'pane-pop', threadId: 't', tabId: 'b', isPopped: true });
  assert.equal(popped.tabs.find((t) => t.id === 'b')?.isPopped, true);
  assert.deepEqual(popped.layout?.columns, [['browser', 'terminal']]);
  const back = run({ ...popped, isOpen: false }, { type: 'pane-pop', threadId: 't', tabId: 'b', isPopped: false });
  assert.deepEqual([back.activeTab, back.isOpen, back.layout?.focused], ['b', true, 'changes']);
});

test('closing several tabs keeps a survivor active, and restoring brings the pane back as it was', () => {
  const others = run(pane(), { type: 'pane-close-tabs', threadId: 't', tabIds: ['a', 'b'] });
  assert.deepEqual(others.tabs.map((t) => t.id), ['c']);
  assert.equal(others.activeTab, 'c');
  assert.deepEqual(run(others, { type: 'pane-restore', pane: pane() }), pane());
});

test('expand, focus, move and resize change only the layout', () => {
  const p = run(pane(), { type: 'pane-expand', threadId: 't', kind: 'changes' });
  assert.deepEqual([p.layout?.expanded, p.layout?.focused], ['changes', 'changes']);
  assert.equal(run(p, { type: 'pane-expand', threadId: 't', kind: undefined }).layout?.expanded, undefined);
  assert.equal(run(pane(), { type: 'pane-focus-kind', threadId: 't', kind: 'terminal' }).activeTab, 'c');
  assert.deepEqual(run(pane(), { type: 'pane-move-kind', threadId: 't', kind: 'terminal', col: 1, row: 0 }).layout?.columns, [['browser', 'changes'], ['terminal']]);
  assert.equal(run(pane(), { type: 'pane-resize', threadId: 't', patch: { share: 0.5 } }).layout?.share, 0.5);
});

test('a popped-out open adds a floating tab without opening the pane or changing its selection', () => {
  const p = run(pane({ isOpen: false }), { type: 'pane-open-tab', threadId: 't', kind: 'visual', title: 'Latency', visual: { language: 'svg', code: '<svg/>' }, isPopped: true });
  assert.deepEqual([p.isOpen, p.activeTab], [false, 'a']);
  assert.deepEqual(p.tabs.at(-1), { id: p.tabs.at(-1)!.id, kind: 'visual', title: 'Latency', visual: { language: 'svg', code: '<svg/>' }, isPopped: true, url: undefined, file: undefined });
});

test('a background tab leaves the layout and your pane in front, and a thread with no pane gets a closed one', () => {
  const fresh = run(undefined, { type: 'pane-open-tab', threadId: 't', kind: 'browser', url: 'localhost:3000', isBackground: true });
  assert.equal(fresh.isOpen, false);
  assert.equal(fresh.activeTab, fresh.tabs[0].id);
  const beside = run(pane({ activeTab: 'b' }), { type: 'pane-open-tab', threadId: 't', kind: 'browser', isBackground: true });
  assert.deepEqual([beside.isOpen, beside.activeTab, beside.tabs.length], [true, 'b', 4]);
  assert.equal(shownTab(beside, 'browser')?.id, 'a');
});

test('showing an agent opens the Agents pane with that agent picked', () => {
  const p = run(pane(), { type: 'pane-show-agent', threadId: 't', subagentId: 's1' });
  assert.equal(p.tabs.find((t) => t.kind === 'agents')?.agentId, 's1');
  assert.equal(p.layout?.focused, 'agents');
});
