import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withLivePr } from './prs.ts';

const live = (state: string) => ({ number: 7, url: 'https://github.com/o/r/pull/7', title: 'Fix', state, checks: [] });

test("the branch's live PR is added, updates a known one by number, and a closed one is left out", () => {
  assert.deepEqual(withLivePr([], live('OPEN')), [{ number: 7, state: 'open', title: 'Fix', url: 'https://github.com/o/r/pull/7' }]);
  assert.deepEqual(withLivePr([{ number: 7, state: 'open', title: 'Old' }], live('MERGED')), [{ number: 7, state: 'merged', title: 'Fix', url: 'https://github.com/o/r/pull/7' }]);
  const known = [{ number: 1, state: 'merged' as const, title: 'A' }];
  assert.equal(withLivePr(known, live('CLOSED')), known);
  assert.equal(withLivePr(known, null), known);
});
