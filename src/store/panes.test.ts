import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pane } from '../model.ts';
import type { State } from './index.tsx';
import { panesReducer } from './panes.ts';

const pane = (rest: Partial<Pane> = {}): Pane => ({
  threadId: 't',
  isOpen: true,
  activeTab: 'a',
  tabs: [
    { id: 'a', kind: 'browser' },
    { id: 'b', kind: 'changes' },
    { id: 'c', kind: 'terminal' },
  ],
  ...rest,
});
const run = (p: Pane | undefined, ...actions: Parameters<typeof panesReducer>[1][]) =>
  actions.reduce((s, a) => panesReducer(s, a), { panes: p ? [p] : [], threads: [] } as unknown as State).panes[0];

test('opening a kind replaces the active new-tab page in place and selects it', () => {
  const p = run(undefined, { type: 'pane-toggle', threadId: 't' }, { type: 'pane-open-tab', threadId: 't', kind: 'files' });
  assert.deepEqual(p.tabs.map((t) => t.kind), ['files']);
  assert.equal(p.activeTab, p.tabs[0].id);
  const q = run(p, { type: 'pane-open-tab', threadId: 't', kind: 'ports' });
  assert.deepEqual(q.tabs.map((t) => t.kind), ['files', 'ports']);
  assert.notEqual(q.tabs[0].id, q.tabs[1].id);
});

test('closing the active tab selects its right neighbour, then its left, and the last close hides the pane', () => {
  assert.equal(run(pane(), { type: 'pane-close-tab', threadId: 't', tabId: 'a' }).activeTab, 'b');
  assert.equal(run(pane({ activeTab: 'c' }), { type: 'pane-close-tab', threadId: 't', tabId: 'c' }).activeTab, 'b');
  assert.equal(run(pane({ activeTab: 'b' }), { type: 'pane-close-tab', threadId: 't', tabId: 'a' }).activeTab, 'b');
  const empty = run(pane(), ...['a', 'b', 'c'].map((tabId) => ({ type: 'pane-close-tab' as const, threadId: 't', tabId })));
  assert.equal(empty.isOpen, false);
  assert.equal(empty.activeTab, '');
});

test('reorder follows the given order and keeps unlisted tabs after it', () => {
  const p = run(pane(), { type: 'pane-reorder', threadId: 't', order: ['c', 'a'] });
  assert.deepEqual(p.tabs.map((t) => t.id), ['c', 'a', 'b']);
});

test('popping out any kind moves selection to a docked neighbour, putting back selects it and opens the pane', () => {
  const popped = run(pane({ activeTab: 'b' }), { type: 'pane-pop', threadId: 't', tabId: 'b', isPopped: true });
  assert.equal(popped.tabs.find((t) => t.id === 'b')?.isPopped, true);
  assert.equal(popped.activeTab, 'c');
  const back = run({ ...popped, isOpen: false }, { type: 'pane-pop', threadId: 't', tabId: 'b', isPopped: false });
  assert.equal(back.activeTab, 'b');
  assert.equal(back.isOpen, true);
  assert.equal(back.tabs.find((t) => t.id === 'b')?.isPopped, false);
});

test('closing several tabs keeps a survivor active, and restoring brings the pane back as it was', () => {
  const others = run(pane(), { type: 'pane-close-tabs', threadId: 't', tabIds: ['a', 'b'] });
  assert.deepEqual(others.tabs.map((t) => t.id), ['c']);
  assert.equal(others.activeTab, 'c');
  const right = run(pane({ activeTab: 'c' }), { type: 'pane-close-tabs', threadId: 't', tabIds: ['b', 'c'] });
  assert.equal(right.activeTab, 'a');
  assert.deepEqual(run(others, { type: 'pane-restore', pane: pane() }), pane());
});

test('showing a kind selects its docked tab and opens the pane, or opens a new tab when there is none', () => {
  const shown = run(pane({ isOpen: false, tabs: [{ id: 'a', kind: 'browser' }, { id: 'b', kind: 'changes' }], activeTab: 'a' }), { type: 'pane-show-tab', threadId: 't', kind: 'changes' });
  assert.deepEqual([shown.isOpen, shown.activeTab, shown.tabs.length], [true, 'b', 2]);
  const added = run(pane({ tabs: [{ id: 'a', kind: 'changes', isPopped: true }], activeTab: '' }), { type: 'pane-show-tab', threadId: 't', kind: 'changes' });
  assert.equal(added.tabs.length, 2);
  assert.equal(added.activeTab, added.tabs[1].id);
});

test('a popped-out open adds a floating tab without opening the pane or changing its selection', () => {
  const p = run(pane({ isOpen: false }), { type: 'pane-open-tab', threadId: 't', kind: 'visual', title: 'Latency', visual: { language: 'svg', code: '<svg/>' }, isPopped: true });
  assert.deepEqual([p.isOpen, p.activeTab], [false, 'a']);
  assert.deepEqual(p.tabs.at(-1), { id: p.tabs.at(-1)!.id, kind: 'visual', title: 'Latency', visual: { language: 'svg', code: '<svg/>' }, isPopped: true, url: undefined, file: undefined });
});
