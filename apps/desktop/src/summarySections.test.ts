import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { McpServer, Thread } from './model.ts';
import { summarize } from './summary.ts';
import {
  brokenConnectors,
  connectorUsage,
  orderCards,
  savedOrder,
  summaryCards,
} from './summarySections.ts';

const thread = (patch: Partial<Thread>) =>
  ({
    id: 't',
    spaceId: 's',
    status: 'running',
    goal: '',
    repo: null,
    activity: [],
    sources: [],
    prs: [],
    steps: [],
    revisions: [],
    startedAt: 0,
    context: { used: 0, max: 0 },
    ...patch,
  }) as Thread;
const cards = (
  t: Thread,
  portCount = 0,
  outputCount = 0,
  linkedThreadCount = 0,
) =>
  summaryCards({
    thread: t,
    summary: summarize(t.activity),
    linkedThreadCount,
    portCount,
    outputCount,
  });

test('a folderless chat shows only its sources', () => {
  assert.deepEqual(cards(thread({})), ['sources']);
});

test('the threads card appears once a parent, sub-thread or reply is linked', () => {
  assert.deepEqual(cards(thread({}), 0, 0, 1), ['threads', 'sources']);
});

test('a listening server shows the running card first', () => {
  assert.deepEqual(cards(thread({}), 1), ['running', 'sources']);
});

test('outputs alone bring the changes card, even without a repo', () => {
  assert.deepEqual(cards(thread({}), 0, 2), ['changes', 'sources']);
});

test('a repo always has a changes card, so a PR can be opened from it', () => {
  assert.deepEqual(
    cards(
      thread({ repo: { project: 'mochi', branch: 'b' } as Thread['repo'] }),
    ),
    ['changes', 'sources'],
  );
});

test('a PR keeps the changes card in a chat without a repo', () => {
  assert.deepEqual(
    cards(thread({ prs: [{ number: 1, state: 'open', title: 'x' }] })),
    ['changes', 'sources'],
  );
});

test('only connectors that need sign-in or failed need you', () => {
  assert.deepEqual(
    brokenConnectors([
      { name: 'a', status: 'connected' },
      { name: 'b', status: 'needs-auth' },
      { name: 'c', status: 'failed' },
      { name: 'd', status: 'pending' },
    ]).map((s) => s.name),
    ['b', 'c'],
  );
});

test('only connectors this thread called, most called first', () => {
  const servers = [
    { name: 'figma', status: 'connected' },
    { name: 'linear', status: 'connected' },
    { name: 'slack', status: 'connected' },
  ] satisfies McpServer[];
  const rows = connectorUsage(servers, [
    { server: 'linear', calls: 3, tools: ['get_issue'] },
    { server: 'slack', calls: 1, tools: ['post'] },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.server.name, r.calls]),
    [
      ['linear', 3],
      ['slack', 1],
    ],
  );
});

test('dragged order wins; cards never placed keep their default slot', () => {
  assert.deepEqual(
    orderCards(['running', 'changes', 'sources'], ['sources', 'running']),
    ['sources', 'changes', 'running'],
  );
  assert.deepEqual(orderCards(['changes', 'sources'], ['bogus', 'sources']), [
    'changes',
    'sources',
  ]);
});

test('a drag keeps hidden cards in the saved order', () => {
  assert.deepEqual(
    savedOrder(['sources', 'changes'], ['running', 'changes', 'sources']),
    ['sources', 'changes', 'running'],
  );
});

test('the running card shows only while a task runs', () => {
  const task = (status: 'running' | 'done') =>
    ({
      id: 'b1',
      kind: 'shell',
      provider: 'claude',
      title: 'sleep 5',
      status,
      startedAt: 0,
    }) as const;
  assert.deepEqual(cards(thread({ backgroundTasks: [task('running')] })), [
    'running',
    'sources',
  ]);
  assert.deepEqual(
    cards(thread({ backgroundTasks: [task('done')] })),
    ['sources'],
    'finished tasks stay in the tab, not the card',
  );
});
