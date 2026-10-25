import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { sameView } from '../layout/tree.ts';
import { structuralEqual } from './structuralEqual.ts';

test('views and nested snapshots compare by structure, preserving array order and distinguishing missing keys', () => {
  assert.ok(
    sameView(
      { kind: 'tab', threadId: 'thread', tabId: 'tab' },
      { tabId: 'tab', threadId: 'thread', kind: 'tab' },
    ),
  );
  assert.ok(
    structuralEqual(
      { preview: { url: 'x', tabId: 'tab' }, line: [1, 2] },
      { line: [1, 2], preview: { tabId: 'tab', url: 'x' } },
    ),
  );
  assert.ok(!structuralEqual({ line: [1, 2] }, { line: [2, 1] }));
  assert.ok(!structuralEqual({ value: undefined }, {}));
  assert.ok(!structuralEqual({ a: undefined }, { b: undefined }));
  assert.ok(!structuralEqual(null, {}));
  assert.ok(!structuralEqual([], {}));
  assert.ok(!structuralEqual(Array(1), []));
});
