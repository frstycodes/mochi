import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { buildQuery, currentPr, toPullRequest, type Ask } from './nodes.ts';
import type { AutofixSnapshot, BranchPrs } from './schema.ts';

const parse = (asks: Ask[], data: object) => buildQuery('o', 'r', asks).parse(data as never, 0);

test('one query per repository: names and branches are variables, numbers inline, fragments only when used', () => {
  const { query, variables } = buildQuery('o"){x}', 'r', [
    { _tag: 'BranchPrs', branch: 'feat/x' },
    { _tag: 'Ref', number: 5 },
    { _tag: 'OpenPrs', isReviewRequested: true },
  ]);
  assert.match(query, /repository\(owner: \$owner, name: \$name\)/);
  assert.match(query, /a0: pullRequests\(headRefName: \$b0,/);
  assert.match(query, /a1: issueOrPullRequest\(number: 5\)/);
  assert.match(query, /a2: search\(query: \$q2, type: ISSUE/);
  assert.doesNotMatch(query, /fragment Autofix|viewer/);
  assert.ok(!query.includes('o"){x}'));
  assert.deepEqual(variables, { owner: 'o"){x}', name: 'r', b0: 'feat/x', q2: 'repo:o"){x}/r is:pr is:open review-requested:@me' });
});

test("a branch's PRs leave out forks; gh pr view's pick is the open one", () => {
  const node = (number: number, state: string, isCrossRepository = false) => ({ number, url: `u${number}`, title: 't', state, isDraft: false, isCrossRepository, commits: { nodes: [] } });
  const prs = parse([{ _tag: 'BranchPrs', branch: 'b' }], { repository: { a0: { nodes: [node(3, 'MERGED'), node(2, 'OPEN', true), node(1, 'OPEN')] } } }) as BranchPrs;
  assert.deepEqual(prs.prs.map((p) => p.number), [3, 1]);
  assert.equal(currentPr(prs.prs)?.number, 1);
  assert.equal(currentPr([]), null);
  assert.deepEqual(
    [{ state: 'OPEN', isDraft: true }, { state: 'MERGED', isDraft: false }, { state: 'CLOSED', isDraft: false }, { state: 'OPEN', isDraft: false }].map((p) => toPullRequest({ ...prs.prs[0]!, ...(p as { state: 'OPEN' }) }).state),
    ['draft', 'merged', 'closed', 'open'],
  );
});

test('refs map to states; an unresolved one is null', () => {
  const pr = {
    __typename: 'PullRequest',
    title: 'A',
    url: 'u0',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'CONFLICTING',
    reviewDecision: 'CHANGES_REQUESTED',
    updatedAt: '2026-10-13T10:00:00Z',
    author: { login: 'ana', avatarUrl: 'a.png' },
    headRefName: 'feat/a',
    baseRefName: 'main',
    additions: 12,
    deletions: 3,
    changedFiles: 2,
    autoMergeRequest: { enabledAt: '2026-10-13T10:00:00Z' },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: 'FAILURE',
              contexts: {
                totalCount: 5,
                checkRunCountsByState: [
                  { state: 'SUCCESS', count: 2 },
                  { state: 'SKIPPED', count: 1 },
                  { state: 'FAILURE', count: 1 },
                ],
                statusContextCountsByState: [{ state: 'PENDING', count: 1 }],
              },
            },
          },
        },
      ],
    },
  };
  const ask: Ask[] = [{ _tag: 'Ref', number: 1 }];
  assert.deepEqual(parse(ask, { repository: { a0: pr } }), {
    kind: 'pr',
    status: 'open',
    title: 'A',
    url: 'u0',
    hasConflicts: true,
    isAutoMerge: true,
    checks: 'fail',
    checkCounts: { passed: 3, total: 5 },
    review: 'changes',
    isNotPlanned: false,
    author: { login: 'ana', avatarUrl: 'a.png' },
    updatedAt: '2026-10-13T10:00:00Z',
    branch: { head: 'feat/a', base: 'main' },
    diff: { added: 12, removed: 3, files: 2 },
  });
  assert.deepEqual(parse(ask, { repository: { a0: { __typename: 'Issue', title: 'B', url: 'u1', state: 'CLOSED', stateReason: 'NOT_PLANNED', author: null } } }), {
    kind: 'issue', status: 'closed', title: 'B', url: 'u1', hasConflicts: false, isAutoMerge: false, checks: null, checkCounts: null, review: null, isNotPlanned: true, author: null, updatedAt: null, branch: null, diff: null,
  });
  assert.equal(parse(ask, { repository: { a0: null } }), null);
});

test("Auto-fix reads check states, conflicts, others' comments, unresolved inline threads", () => {
  const data = {
    viewer: { login: 'me' },
      repository: {
        a0: {
          state: 'OPEN',
          url: 'u',
          headRefOid: 'sha',
          mergeable: 'CONFLICTING',
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    contexts: {
                      nodes: [
                        { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/1/job/2' },
                        { __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', conclusion: null },
                        { __typename: 'CheckRun', name: 'skip', status: 'COMPLETED', conclusion: 'SKIPPED' },
                        { __typename: 'StatusContext', context: 'vercel', state: 'SUCCESS', targetUrl: null },
                      ],
                    },
                  },
                },
              },
            ],
          },
          comments: { nodes: [{ databaseId: 1, author: { login: 'bob' }, body: 'hi', url: 'c1' }, { databaseId: 9, author: { login: 'me' }, body: 'Fixed in abc', url: 'c9' }] },
          reviews: { nodes: [{ databaseId: 2, author: null, body: '', url: 'r2' }] },
          reviewThreads: {
            nodes: [
              { isResolved: false, path: 'a.ts', line: 3, comments: { nodes: [{ databaseId: 3, author: { login: 'eve' }, body: 'rename', url: 'c3' }] } },
              { isResolved: true, path: 'b.ts', line: 1, comments: { nodes: [{ databaseId: 4, author: { login: 'eve' }, body: 'done', url: 'c4' }] } },
            ],
          },
        },
      },
  };
  const parsed = parse([{ _tag: 'PrDetail', number: 7 }], data) as AutofixSnapshot;
  assert.deepEqual(
    parsed.checks.map((c) => c.state),
    ['fail', 'pending', 'skip', 'pass'],
  );
  assert.equal(parsed.isConflicting, true);
  assert.deepEqual(
    parsed.comments.map((c) => [c.id, c.author, c.where]),
    [
      ['1', 'bob', undefined],
      ['3', 'eve', 'a.ts:3'],
    ],
  );
  assert.equal(parse([{ _tag: 'PrDetail', number: 7 }], { repository: { a0: null } }), null);
});
