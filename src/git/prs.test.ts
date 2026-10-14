import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createdPr, prsOnBranches, recordPrs, type GhPr } from './prs.ts';

const url = 'https://github.com/o/r/pull/7';

test('a seen PR is added, updates a known one by number, and leaves the list as it was when nothing changed', () => {
  const pr = { number: 7, state: 'open' as const, title: 'Fix', url };
  assert.deepEqual(recordPrs([], [pr]), [pr]);
  assert.deepEqual(recordPrs([{ number: 7, state: 'open', title: 'Old' }], [{ ...pr, state: 'merged' }]), [{ ...pr, state: 'merged' }]);
  const known = [{ number: 1, state: 'merged' as const, title: 'A' }, pr];
  assert.equal(recordPrs(known, [{ ...pr }]), known);
  assert.deepEqual(recordPrs(known, [pr, pr]), known, 'deduped by number');
});

test("gh's list keeps the threads' branches: open, draft and merged, never closed or a fork's same-named branch", () => {
  const row = (over: Partial<GhPr>): GhPr => ({ number: 7, url, title: 'Fix', state: 'OPEN', isDraft: false, headRefName: 'feat/x', isCrossRepository: false, ...over });
  const rows = [row({}), row({ number: 8, isDraft: true }), row({ number: 9, state: 'MERGED' }), row({ number: 10, state: 'CLOSED' }), row({ number: 11, isCrossRepository: true }), row({ number: 12, headRefName: 'main' })];
  assert.deepEqual(
    prsOnBranches(rows, new Set(['feat/x'])).map(({ branch, pr }) => [branch, pr.number, pr.state]),
    [['feat/x', 7, 'open'], ['feat/x', 8, 'draft'], ['feat/x', 9, 'merged']],
  );
});

test('a gh pr create run gives its PR from the printed URL, title from the command, draft from the flag', () => {
  const output = 'Warning: 2 uncommitted changes\n\nCreating pull request for feat/x into main in o/r\n\nhttps://github.com/o/r/pull/95\n';
  assert.deepEqual(createdPr('Run gh pr create --title "Simplify summary panel" --body "…"', output), { number: 95, state: 'open', title: 'Simplify summary panel', url: 'https://github.com/o/r/pull/95' });
  assert.equal(createdPr("Run git push -u origin HEAD && gh pr create -t 'Fix' --draft", output)?.state, 'draft');
  assert.equal(createdPr('Run gh pr create --fill', 'a pull request for branch "feat/x" into branch "main" already exists:\nhttps://github.com/o/r/pull/94')?.number, 94);
  assert.equal(createdPr('Run gh pr view', output), null);
  assert.equal(createdPr('Run gh pr create --fill', 'error: no commits'), null);
  assert.equal(createdPr('Run gh pr create --fill', undefined), null);
});
