import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { ChatRow } from './rows.ts';
import { restoredIndex } from './Transcript.tsx';

const rows = ['a', 'b', 'c'].map((key) => ({ key }) as ChatRow);

test('a thread left mid-history reopens on the same row, its top the same distance above the view', () => {
  // LegendList's anchor offset is how far the view's top sat below the row's top; scrollToIndex subtracts viewOffset.
  assert.deepEqual(
    restoredIndex(rows, { anchor: { key: 'b', offset: 40 }, isAtEnd: false }),
    { index: 1, viewOffset: -40 },
  );
});

test('a thread left at the end, never seen, or whose row is gone reopens at the end', () => {
  assert.equal(
    restoredIndex(rows, { anchor: { key: 'b', offset: 40 }, isAtEnd: true }),
    undefined,
  );
  assert.equal(restoredIndex(rows, undefined), undefined);
  assert.equal(
    restoredIndex(rows, { anchor: { key: 'gone', offset: 0 }, isAtEnd: false }),
    undefined,
  );
  assert.equal(
    restoredIndex(rows, { anchor: undefined, isAtEnd: false }),
    undefined,
  );
});
