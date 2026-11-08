import { expect, test } from 'vite-plus/test';
import {
  finishedChecksFirst,
  mergeCheckSummary,
  mergeCheckTitle,
} from './mergeChecks';
import type { PrCheck } from '../host/types/git';

test('completed results precede running checks without mutating the input', () => {
  const checks: PrCheck[] = [
    { name: 'running first', state: 'pending' },
    { name: 'failed', state: 'fail' },
    { name: 'passed', state: 'pass' },
    { name: 'running second', state: 'pending' },
    { name: 'skipped', state: 'skipping' },
    { name: 'cancelled', state: 'cancel' },
  ];
  expect(finishedChecksFirst(checks).map((check) => check.name)).toEqual([
    'failed',
    'passed',
    'skipped',
    'cancelled',
    'running first',
    'running second',
  ]);
  expect(checks[0].name).toBe('running first');
});

test('handles empty lists and single checks', () => {
  expect(finishedChecksFirst([])).toEqual([]);
  const checks: PrCheck[] = [{ name: 'only', state: 'pending' }];
  expect(finishedChecksFirst(checks)).toEqual(checks);
});

test('titles include failed and running checks and handle completed checks', () => {
  expect(mergeCheckTitle({ failed: 1, running: 3 })).toBe(
    '1 check failed, 3 still running',
  );
  expect(mergeCheckTitle({ failed: 2, running: 0 })).toBe('2 checks failed');
  expect(mergeCheckTitle({ failed: 0, running: 1 })).toBe(
    '1 check still running',
  );
  expect(mergeCheckTitle({ failed: 0, running: 0 })).toBe(
    'All checks finished',
  );
});

test('summary includes every reported state and omits zero counts', () => {
  expect(
    mergeCheckSummary([
      { name: 'a', state: 'pending' },
      { name: 'b', state: 'pass' },
      { name: 'c', state: 'fail' },
      { name: 'd', state: 'skipping' },
      { name: 'e', state: 'cancel' },
    ]),
  ).toBe('1 failed · 1 running · 1 passed · 1 skipped · 1 cancelled');
  expect(mergeCheckSummary([])).toBe('');
});
