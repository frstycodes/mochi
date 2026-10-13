import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRefs, refsQuery, validRef } from './githubRefs.ts';

const refs = [
  { owner: 'o', repo: 'r', number: 1 },
  { owner: 'o', repo: 'r', number: 2 },
  { owner: 'o', repo: 'r', number: 3 },
];

test('one aliased query; names go in as variables, never into the query text', () => {
  const args = refsQuery([{ owner: 'o', repo: 'r', number: 5 }]);
  assert.deepEqual(args.slice(0, 2), ['api', 'graphql']);
  assert.match(args[3], /r0: repository\(owner: \$o0, name: \$n0\) \{ issueOrPullRequest\(number: 5\)/);
  assert.deepEqual(args.slice(4), ['-f', 'o0=o', '-f', 'n0=r']);
  assert.equal(validRef({ owner: 'o"){x}', repo: 'r', number: 1 }), null);
  assert.equal(validRef({ owner: 'o', repo: 'r', number: 0 }), null);
});

test("gh's response maps to states; unresolved refs are left out", () => {
  const json = JSON.stringify({
    data: {
      r0: { issueOrPullRequest: { __typename: 'PullRequest', title: 'A', url: 'u0', state: 'OPEN', isDraft: false, mergeable: 'CONFLICTING', commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } } },
      r1: { issueOrPullRequest: { __typename: 'Issue', title: 'B', url: 'u1', state: 'CLOSED', stateReason: 'NOT_PLANNED' } },
      r2: { issueOrPullRequest: null },
    },
  });
  assert.deepEqual(parseRefs(json, refs), {
    'o/r#1': { kind: 'pr', status: 'open', title: 'A', url: 'u0', hasConflicts: true, isFailing: true, isNotPlanned: false },
    'o/r#2': { kind: 'issue', status: 'closed', title: 'B', url: 'u1', hasConflicts: false, isFailing: false, isNotPlanned: true },
  });
});
