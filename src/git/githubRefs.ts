import type { ChecksState, GithubRef, RefState, ReviewState } from '../chat/refs.ts';
import { refKey } from '../chat/refs.ts';

const NAME = /^[\w.-]{1,100}$/;

/** A ref from the renderer, or null when it isn't one (names GitHub allows, a positive issue number). */
export function validRef(value: unknown): GithubRef | null {
  if (typeof value !== 'object' || value === null) return null;
  const { owner, repo, number } = value as Record<string, unknown>;
  if (typeof owner !== 'string' || typeof repo !== 'string' || !NAME.test(owner) || !NAME.test(repo)) return null;
  if (!Number.isInteger(number) || (number as number) < 1 || (number as number) > 1e9) return null;
  return { owner, repo, number: number as number };
}

/**
 * One GraphQL query for every ref, aliased `r0…rN`; owner and name go in as variables (`-f o0=…`), the validated number inline.
 * `issueOrPullRequest` answers `#n` without knowing which it is.
 */
export function refsQuery(refs: GithubRef[]) {
  const vars = refs.flatMap((_, i) => [`$o${i}: String!`, `$n${i}: String!`]).join(', ');
  const fields = refs.map((r, i) => `r${i}: repository(owner: $o${i}, name: $n${i}) { issueOrPullRequest(number: ${r.number}) { ...S } }`).join('\n');
  const query = `query(${vars}) {\n${fields}\n}
fragment S on IssueOrPullRequest {
  __typename
  ... on PullRequest {
    title url state isDraft mergeable reviewDecision updatedAt author { login avatarUrl(size: 40) } headRefName baseRefName additions deletions changedFiles autoMergeRequest { enabledAt }
    commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 0) { totalCount checkRunCountsByState { state count } statusContextCountsByState { state count } } } } } }
  }
  ... on Issue { title url state stateReason updatedAt author { login avatarUrl(size: 40) } }
}`;
  const args = refs.flatMap((r, i) => ['-f', `o${i}=${r.owner}`, '-f', `n${i}=${r.repo}`]);
  return ['api', 'graphql', '-f', `query=${query}`, ...args];
}

type Node = {
  __typename: 'PullRequest' | 'Issue';
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft?: boolean;
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  stateReason?: string | null;
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  updatedAt?: string;
  author?: { login: string; avatarUrl: string } | null;
  headRefName?: string;
  baseRefName?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  autoMergeRequest?: { enabledAt: string } | null;
  commits?: { nodes: { commit: { statusCheckRollup: Rollup | null } }[] };
};

type Counts = { state: string; count: number }[];
type Rollup = { state: string; contexts?: { totalCount: number; checkRunCountsByState?: Counts; statusContextCountsByState?: Counts } };

/** "3/5": check runs that succeeded, were skipped or neutral, and commit statuses that succeeded, out of every check. */
function checkCounts(rollup: Rollup | null | undefined): RefState['checkCounts'] {
  const contexts = rollup?.contexts;
  if (!contexts?.totalCount) return null;
  const sum = (counts: Counts | undefined, states: string[]) => (counts ?? []).reduce((n, c) => n + (states.includes(c.state) ? c.count : 0), 0);
  const passed = sum(contexts.checkRunCountsByState, ['SUCCESS', 'SKIPPED', 'NEUTRAL']) + sum(contexts.statusContextCountsByState, ['SUCCESS']);
  return { passed, total: contexts.totalCount };
}

/** gh's response → state per `refKey`; refs GitHub didn't resolve (missing, no access) are left out, so they stay unknown. */
export function parseRefs(json: string, refs: GithubRef[]): Record<string, RefState> {
  const data = (JSON.parse(json) as { data?: Record<string, { issueOrPullRequest: Node | null } | null> }).data ?? {};
  const states: Record<string, RefState> = {};
  refs.forEach((ref, i) => {
    const node = data[`r${i}`]?.issueOrPullRequest;
    if (node) states[refKey(ref)] = toState(node);
  });
  return states;
}

function toState(node: Node): RefState {
  const isPr = node.__typename === 'PullRequest';
  const rollup = node.commits?.nodes[0]?.commit.statusCheckRollup;
  const status = node.state === 'MERGED' ? 'merged' : node.state === 'CLOSED' ? 'closed' : node.isDraft ? 'draft' : 'open';
  return {
    kind: isPr ? 'pr' : 'issue',
    status,
    title: node.title,
    url: node.url,
    hasConflicts: status === 'open' && node.mergeable === 'CONFLICTING',
    isAutoMerge: !!node.autoMergeRequest,
    checks: (rollup ? CHECKS[rollup.state] : null) ?? null,
    checkCounts: checkCounts(rollup),
    review: (node.reviewDecision && REVIEWS[node.reviewDecision]) ?? null,
    isNotPlanned: node.stateReason === 'NOT_PLANNED',
    author: node.author ?? null,
    updatedAt: node.updatedAt ?? null,
    branch: isPr && node.headRefName && node.baseRefName ? { head: node.headRefName, base: node.baseRefName } : null,
    diff: isPr && node.additions !== undefined ? { added: node.additions, removed: node.deletions ?? 0, files: node.changedFiles ?? 0 } : null,
  };
}

const CHECKS: Record<string, ChecksState | undefined> = { SUCCESS: 'pass', FAILURE: 'fail', ERROR: 'fail', PENDING: 'pending', EXPECTED: 'pending' };
const REVIEWS = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'required' } satisfies Record<NonNullable<Node['reviewDecision']>, ReviewState>;
