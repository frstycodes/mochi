import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Thread } from './model.ts';
import { summarize } from './summary.ts';
import {
  connectorStatus,
  orderCards,
  savedOrder,
  summaryCards,
} from './summarySections.ts';
import { setPrefs } from './settings/prefs.ts';

// Goals are retired and default off; their code is kept, so these tests turn them on to keep it honest.
setPrefs({ goals: true });

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
    ...patch,
  }) as Thread;
const cards = (t: Thread, portCount = 0, outputCount = 0) =>
  summaryCards({
    thread: t,
    summary: summarize(t.activity),
    portCount,
    outputCount,
  });

test('a folderless chat shows only where it runs and its sources', () => {
  assert.deepEqual(cards(thread({})), ['environment', 'sources']);
});

test('servers, outputs and connectors appear only once there are some', () => {
  const t = thread({
    agent: {
      mcpServers: [{ name: 'linear', status: 'connected' }],
    } as Thread['agent'],
  });
  assert.deepEqual(cards(t, 1, 2), [
    'environment',
    'sources',
    'connectors',
    'servers',
    'outputs',
  ]);
});

test('a repo always has a changes card, so a PR can be opened from it', () => {
  assert.deepEqual(
    cards(
      thread({ repo: { project: 'mochi', branch: 'b' } as Thread['repo'] }),
    ),
    ['environment', 'sources', 'changes'],
  );
});

test('a PR keeps the changes card in a chat without a repo', () => {
  assert.deepEqual(
    cards(thread({ prs: [{ number: 1, state: 'open', title: 'x' }] })),
    ['environment', 'sources', 'changes'],
  );
});

test('connector status leads with what needs you', () => {
  assert.deepEqual(
    connectorStatus([
      { status: 'connected' },
      { status: 'needs-auth' },
      { status: 'failed' },
    ]),
    { text: '2 to reconnect', needsYou: true },
  );
  assert.deepEqual(
    connectorStatus([{ status: 'connected' }, { status: 'connected' }]),
    { text: '2 connected', needsYou: false },
  );
  assert.deepEqual(
    connectorStatus([{ status: 'connected' }, { status: 'pending' }]),
    { text: '1 connecting', needsYou: false },
  );
  assert.deepEqual(
    connectorStatus([{ status: 'connected' }, { status: 'disabled' }]),
    { text: '1 of 2 on', needsYou: false },
  );
});

test('a goal leads the cards', () => {
  assert.deepEqual(cards(thread({ goal: 'Ship it' })).slice(0, 2), [
    'goal',
    'environment',
  ]);
});

test('dragged order wins; cards never placed keep their default slot', () => {
  assert.deepEqual(
    orderCards(
      ['environment', 'sources', 'changes'],
      ['changes', 'environment'],
    ),
    ['changes', 'sources', 'environment'],
  );
  assert.deepEqual(
    orderCards(
      ['environment', 'sources', 'servers', 'changes'],
      ['changes', 'sources', 'environment'],
    ),
    ['changes', 'sources', 'servers', 'environment'],
  );
  assert.deepEqual(
    orderCards(['environment', 'sources'], ['bogus', 'sources']),
    ['environment', 'sources'],
  );
});

test('a drag keeps hidden cards in the saved order', () => {
  assert.deepEqual(
    savedOrder(
      ['sources', 'environment'],
      ['servers', 'environment', 'sources'],
    ),
    ['sources', 'environment', 'servers'],
  );
});

test('the background tasks card shows only while a task runs', () => {
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
    'environment',
    'sources',
    'tasks',
  ]);
  assert.deepEqual(
    cards(thread({ backgroundTasks: [task('done')] })),
    ['environment', 'sources'],
    'finished tasks stay in the tab, not the card',
  );
});
