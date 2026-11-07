import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { ActivityEntry } from '../model.ts';
import { chatRows } from './rows.ts';
import { foldTurns } from './turnFold.ts';

const entry = (
  who: ActivityEntry['who'],
  kind: ActivityEntry['kind'],
  ms: number,
  extra: Partial<ActivityEntry> = {},
): ActivityEntry => ({ at: 0, who, kind, text: `${kind} ${ms}`, ms, ...extra });

const turn: ActivityEntry[] = [
  entry('you', 'message', 1_000),
  entry('claude', 'tool', 2_000, { text: 'Run pnpm test' }),
  entry('claude', 'message', 3_000),
  entry('claude', 'tool', 4_000, { text: 'Read a.ts' }),
  entry('claude', 'message', 5_000),
  entry('harness', 'event', 65_000, { text: 'Turn failed' }),
];

const kinds = (
  activity: ActivityEntry[],
  isRunning: boolean,
  toggled = new Set<string>(),
) =>
  foldTurns(chatRows(activity), activity, isRunning, toggled).map((r) =>
    r.kind === 'worked'
      ? `worked:${r.isOpen ? 'open' : 'shut'}:${r.durationMs ?? '-'}`
      : r.kind,
  );

test('a finished turn folds everything before its final reply and times the whole turn', () => {
  assert.deepEqual(kinds(turn, false), [
    'message',
    'worked:shut:64000',
    'message',
    'event',
  ]);
});

test('opening it shows the work in place', () => {
  const rows = foldTurns(chatRows(turn), turn, false, new Set());
  const key = rows.find((r) => r.kind === 'worked')!.key;
  assert.deepEqual(kinds(turn, false, new Set([key])), [
    'message',
    'worked:open:64000',
    'work',
    'message',
    'work',
    'message',
    'event',
  ]);
});

test('the running turn stays open and keeps counting', () => {
  const live = turn.slice(0, 4);
  assert.deepEqual(kinds(live, true), [
    'message',
    'worked:open:-',
    'work',
    'message',
    'work',
  ]);
});

test('a turn with no reply folds nothing', () => {
  const failed = [turn[0], turn[1], turn[5]];
  assert.deepEqual(kinds(failed, false), ['message', 'work']);
});

test('a widget waiting on you stays out of the fold', () => {
  const asking = [
    turn[0],
    turn[1],
    entry('harness', 'event', 2_500, { card: { id: 'q', isOpen: true } }),
    turn[2],
  ];
  assert.deepEqual(kinds(asking, false), [
    'message',
    'worked:shut:2000',
    'event',
    'message',
  ]);
});
