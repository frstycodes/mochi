import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { compareCells, nextSort } from './cells.ts';
import { parseFence, readWidgetMessage } from './fence.ts';

const chart =
  '{"type":"line","x":"day","data":[{"day":"Mon","calls":3,"errors":1},{"day":"Tue","calls":5,"errors":0}]}';

test('json fences stay pending while streaming and render once they parse', () => {
  assert.deepEqual(parseFence('chart', chart.slice(0, 30), true), {
    status: 'pending',
  });
  const done = parseFence('chart', chart, true);
  assert.equal(done.status, 'ready');
  assert.deepEqual(done.status === 'ready' && done.spec.series, [
    'calls',
    'errors',
  ]);
});

test('a finished fence that does not parse is an error, not a pending frame', () => {
  assert.equal(parseFence('chart', chart.slice(0, 30), false).status, 'error');
  assert.equal(
    parseFence('chart', '{"x":"day","data":[{"day":"Mon","calls":"3"}]}', false)
      .status,
    'error',
  );
  assert.equal(
    parseFence(
      'harness-diff',
      '{"files":[{"path":"a.ts","added":-1,"removed":0}]}',
      false,
    ).status,
    'error',
  );
  assert.equal(
    parseFence('harness-metro', '{"threads":[]}', false).status,
    'error',
  );
});

test('markup waits for the closing fence even when it already looks whole', () => {
  const svg = '<svg viewBox="0 0 1 1"></svg>';
  assert.deepEqual(parseFence('svg', svg, true), { status: 'pending' });
  assert.deepEqual(parseFence('svg', svg, false), {
    status: 'ready',
    spec: svg,
  });
  assert.equal(
    parseFence('svg', '<svg viewBox="0 0 1 1">', false).status,
    'error',
  );
  assert.equal(
    parseFence('html', '<button>Hi</button>', false).status,
    'ready',
  );
});

test('widget messages are shape-checked against the widget id', () => {
  const base = { source: 'harness-widget', id: 'w1' };
  assert.deepEqual(
    readWidgetMessage({ ...base, type: 'prompt', text: '  Show p95  ' }, 'w1'),
    { type: 'prompt', text: 'Show p95' },
  );
  assert.deepEqual(
    readWidgetMessage({ ...base, type: 'size', height: 120 }, 'w1'),
    { type: 'size', height: 120 },
  );
  assert.equal(
    readWidgetMessage({ ...base, type: 'prompt', text: 'x' }, 'w2'),
    null,
  );
  assert.equal(
    readWidgetMessage({ ...base, type: 'prompt', text: '   ' }, 'w1'),
    null,
  );
  assert.equal(
    readWidgetMessage(
      { ...base, type: 'prompt', text: 'x'.repeat(5000) },
      'w1',
    ),
    null,
  );
  assert.equal(
    readWidgetMessage({ ...base, type: 'say', text: 'x' }, 'w1'),
    null,
  );
  assert.equal(readWidgetMessage('prompt', 'w1'), null);
});

test('table cells sort numbers by value and text naturally', () => {
  const sorted = (cells: string[]) => [...cells].sort(compareCells);
  assert.deepEqual(sorted(['1,200', '980', '15']), ['15', '980', '1,200']);
  assert.deepEqual(sorted(['140ms', '90ms', '1200ms']), [
    '90ms',
    '140ms',
    '1200ms',
  ]);
  assert.deepEqual(sorted(['$12', '$9.50', '-3']), ['-3', '$9.50', '$12']);
  assert.deepEqual(sorted(['step 10', 'step 2', 'Step 1']), [
    'Step 1',
    'step 2',
    'step 10',
  ]);
  assert.deepEqual(nextSort(null, 2), { col: 2, dir: 'asc' });
  assert.deepEqual(nextSort({ col: 2, dir: 'asc' }, 2), {
    col: 2,
    dir: 'desc',
  });
  assert.equal(nextSort({ col: 2, dir: 'desc' }, 2), null);
  assert.deepEqual(nextSort({ col: 2, dir: 'desc' }, 0), {
    col: 0,
    dir: 'asc',
  });
});
