import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { contextBreakdown } from './contextBreakdown.ts';

test('the window is used + buffer + free; deferred and empty rows stay out, the largest used rows take the chart colours', () => {
  const { rows, deferred, used, window, share } = contextBreakdown(
    {
      totalTokens: 300,
      categories: [
        { name: 'System prompt', tokens: 100, kind: 'used' },
        { name: 'Skills', tokens: 0, kind: 'used' },
        { name: 'Messages', tokens: 200, kind: 'used' },
        { name: 'Autocompact buffer', tokens: 100, kind: 'buffer' },
        { name: 'Free space', tokens: 600, kind: 'free' },
        { name: 'MCP tools (deferred)', tokens: 5000, kind: 'deferred' },
      ],
    },
    { used: 0, max: 0 },
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.share, r.color]),
    [
      ['Messages', 0.2, 'var(--chart-1)'],
      ['System prompt', 0.1, 'var(--chart-2)'],
      [
        'Autocompact buffer',
        0.1,
        'color-mix(in oklab, var(--muted-foreground) 35%, transparent)',
      ],
      ['Free space', 0.6, 'var(--muted)'],
    ],
  );
  assert.deepEqual(
    deferred.map((r) => r.name),
    ['MCP tools (deferred)'],
  );
  assert.deepEqual([used, window, share], [300, 1000, 0.3]);
});

test('without a live breakdown the thread total splits into used and free', () => {
  const { rows, share } = contextBreakdown(null, { used: 50, max: 200 });
  assert.deepEqual(
    rows.map((r) => [r.name, r.tokens]),
    [
      ['Used', 50],
      ['Free space', 150],
    ],
  );
  assert.equal(share, 0.25);
});
