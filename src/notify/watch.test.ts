import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CheckState, PrInfo } from '../host/types/git.ts';
import { ciTitle, ciTransition, coalesce, type CiSeen, type OsNotice } from './watch.ts';

const pr = (states: CheckState[], number = 7): PrInfo => ({ number, title: 'Fix login', url: `https://github.com/o/r/pull/${number}`, state: 'OPEN', checks: states.map((state, i) => ({ name: `check-${i}`, state })) });

/** Feeds snapshots through the transition like successive polls; returns what each poll reported. */
function polls(...snapshots: PrInfo[]) {
  let seen: CiSeen | undefined;
  return snapshots.map((s) => {
    const next = ciTransition(seen, s);
    seen = next.seen;
    return next.result?.status ?? null;
  });
}

test('pass and fail are reported once, on the transition', () => {
  assert.deepEqual(polls(pr(['pending']), pr(['pending', 'pass']), pr(['fail', 'pending']), pr(['fail', 'pass'])), [null, null, 'fail', null]);
  assert.deepEqual(polls(pr(['pending']), pr(['pass', 'skipping'])), [null, 'pass']);
});

test('a new push that goes pending reports the next result again', () => {
  assert.deepEqual(polls(pr(['pending']), pr(['fail']), pr(['pending']), pr(['fail'])), [null, 'fail', null, 'fail']);
});

test('the first look at a PR, a new PR, or no checks set a baseline without reporting', () => {
  assert.deepEqual(polls(pr(['fail'])), [null]);
  assert.deepEqual(polls(pr(['pending'], 1), pr(['fail'], 2)), [null, null]);
  assert.deepEqual(polls(pr(['pending']), pr([]), pr(['fail'])), [null, null, 'fail']);
});

test('a failure names its failed checks', () => {
  const { result } = ciTransition({ pr: 7, status: 'pending' }, pr(['pass', 'fail', 'fail']));
  assert.deepEqual(result?.failed.map((c) => c.name), ['check-1', 'check-2']);
  assert.equal(ciTitle(result!), 'CI failed on #7: check-1 and 1 more');
  assert.equal(ciTitle({ pr: 7, status: 'pass', failed: [] }), 'CI passed on #7');
});

const notice = (threadId: string, body: string, requestId?: string): OsNotice => ({ threadId, kind: 'needs-you', title: `Thread ${threadId}`, body, requestId });

test('a burst folds per thread and drops approval buttons it can no longer pin to one request', () => {
  const out = coalesce([notice('a', 'Approve: rm -rf dist', 'r1'), notice('a', 'Turn finished'), notice('b', 'Asks a question')]);
  assert.deepEqual(out, [
    { threadId: 'a', kind: 'needs-you', title: 'Thread a', body: 'Approve: rm -rf dist\nTurn finished' },
    notice('b', 'Asks a question'),
  ]);
  assert.equal(coalesce([notice('a', 'x', 'r1')])[0].requestId, 'r1');
});

test('more than two threads in a burst become one summary', () => {
  const out = coalesce([notice('a', '1'), notice('b', '2'), notice('c', '3'), notice('a', '4')]);
  assert.deepEqual(out, [{ threadId: '', kind: 'summary', title: '3 threads need a look', body: 'Thread a\nThread b\nThread c' }]);
});
