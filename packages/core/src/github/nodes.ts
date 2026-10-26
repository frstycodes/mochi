import type { Git } from '@mochi/schema';
import type {
  AutofixCheck,
  AutofixComment,
  AutofixSnapshot,
  BranchPr,
  BranchPrs,
  OpenPr,
} from './schema.ts';

/** What one surface asks of a repository in a poll. Every ask on one repository becomes one aliased field of one query. */
export type Ask =
  | { readonly _tag: 'BranchPrs'; readonly branch: string }
  | { readonly _tag: 'PrDetail'; readonly number: number }
  | { readonly _tag: 'Ref'; readonly number: number }
  | { readonly _tag: 'OpenPrs'; readonly isReviewRequested: boolean };

export interface Query {
  readonly query: string;
  readonly variables: Record<string, string>;
  /** The ask's value from the response's `data`. */
  readonly parse: (data: Data, index: number) => unknown;
}

type Data = Record<string, unknown> & {
  viewer?: { login: string };
  repository?: Record<string, unknown> | null;
};

// 5 PRs per branch, since a reused branch name rarely has more; the scheduler sees only the newest 50 open PRs.
const BRANCH_PRS = 5;
const OPEN_PRS = 50;

/** Numbers go into the query text, not variables, so only these. */
export const isIssueNumber = (n: number) =>
  Number.isInteger(n) && n >= 1 && n <= 1e9;

/** One query for every ask on `owner/name`; owner, name, branches and search strings are variables, numbers are validated ints. */
export function buildQuery(
  owner: string,
  name: string,
  asks: ReadonlyArray<Ask>,
): Query {
  const variables: Record<string, string> = { owner, name };
  const declared = ['$owner: String!', '$name: String!'];
  const inRepo: string[] = [];
  const top: string[] = [];
  const fragments = new Set<string>();
  asks.forEach((ask, i) => {
    const alias = `a${i}`;
    if (ask._tag === 'BranchPrs') {
      declared.push(`$b${i}: String!`);
      variables[`b${i}`] = ask.branch;
      inRepo.push(
        `${alias}: pullRequests(headRefName: $b${i}, first: ${BRANCH_PRS}, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ...BranchPr } }`,
      );
      fragments.add(BRANCH_PR).add(CHECKS);
    } else if (ask._tag === 'PrDetail') {
      inRepo.push(
        `${alias}: pullRequest(number: ${ask.number}) { ...Autofix }`,
      );
      fragments.add(AUTOFIX).add(CHECKS);
    } else if (ask._tag === 'Ref') {
      inRepo.push(
        `${alias}: issueOrPullRequest(number: ${ask.number}) { ...Ref }`,
      );
      fragments.add(REF);
    } else if (ask.isReviewRequested) {
      declared.push(`$q${i}: String!`);
      variables[`q${i}`] =
        `repo:${owner}/${name} is:pr is:open review-requested:@me`;
      top.push(
        `${alias}: search(query: $q${i}, type: ISSUE, first: ${OPEN_PRS}) { nodes { ... on PullRequest { ...OpenPr } } }`,
      );
      fragments.add(OPEN_PR);
    } else {
      inRepo.push(
        `${alias}: pullRequests(states: OPEN, first: ${OPEN_PRS}, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ...OpenPr } }`,
      );
      fragments.add(OPEN_PR);
    }
  });
  const viewer = asks.some((a) => a._tag === 'PrDetail')
    ? 'viewer { login }\n'
    : '';
  const query = `query(${declared.join(', ')}) {\n${viewer}repository(owner: $owner, name: $name) {\n${inRepo.join('\n')}\n}\n${top.join('\n')}\n}\n${[...fragments].join('\n')}`;
  return {
    query,
    variables,
    parse: (data, i) => parseAsk(asks[i]!, data, `a${i}`),
  };
}

function parseAsk(ask: Ask, data: Data, alias: string): unknown {
  const field = (
    ask._tag === 'OpenPrs' && ask.isReviewRequested
      ? data
      : (data.repository ?? {})
  )[alias];
  if (ask._tag === 'BranchPrs')
    return branchPrs(
      ask.branch,
      (field as Connection<PrNode> | null)?.nodes ?? [],
    );
  if (ask._tag === 'PrDetail')
    return field ? toAutofix(field as AutofixNode, data.viewer?.login) : null;
  if (ask._tag === 'Ref') return field ? toRefState(field as RefNode) : null;
  return (
    (field as Connection<OpenNode | Record<string, never>> | null)?.nodes ?? []
  )
    .filter((n): n is OpenNode => 'number' in n)
    .map((n) => toOpenPr(n, ask.isReviewRequested));
}

/** `gh pr view`'s pick: the branch's open PR, else its newest one. */
export function currentPr(prs: ReadonlyArray<BranchPr>) {
  const pr = prs.find((p) => p.state === 'OPEN') ?? prs[0];
  return pr
    ? {
        number: pr.number,
        url: pr.url,
        title: pr.title,
        state: pr.state,
        checks: [...pr.checks],
      }
    : null;
}

/** A branch PR as the thread records it (`thread.prs`). */
export const toPullRequest = (pr: BranchPr) => ({
  number: pr.number,
  state:
    pr.state === 'MERGED'
      ? ('merged' as const)
      : pr.state === 'CLOSED'
        ? ('closed' as const)
        : pr.isDraft
          ? ('draft' as const)
          : ('open' as const),
  title: pr.title,
  url: pr.url,
});

/** Stable cache key and display label: `owner/repo#n` (`src/chat/refs.ts` `refKey`). */
export const refKey = (ref: { owner: string; repo: string; number: number }) =>
  `${ref.owner}/${ref.repo}#${ref.number}`;

type Connection<T> = { nodes: T[] };

const CHECKS = `fragment Checks on Commit { statusCheckRollup { state contexts(first: 100) { nodes {
  __typename
  ... on CheckRun { name status conclusion detailsUrl }
  ... on StatusContext { context state targetUrl }
} } } }`;

// branch PRs

const BRANCH_PR = `fragment BranchPr on PullRequest { number url title state isDraft isCrossRepository commits(last: 1) { nodes { commit { ...Checks } } } }`;

type PrNode = {
  number: number;
  url: string;
  title: string;
  state: BranchPr['state'];
  isDraft: boolean;
  isCrossRepository: boolean;
  commits: Connection<{ commit: CommitNode }>;
};
type CommitNode = {
  statusCheckRollup: {
    state?: string;
    contexts: Connection<GqlContext>;
  } | null;
};

function branchPrs(branch: string, nodes: PrNode[]): BranchPrs {
  // A fork's PR from a branch of the same name isn't this worktree's.
  const prs = nodes
    .filter((n) => !n.isCrossRepository)
    .map((n) => ({
      number: n.number,
      url: n.url,
      title: n.title,
      state: n.state,
      isDraft: n.isDraft,
      checks: contextsOf(n.commits).map(prCheck),
    }));
  return { branch, prs };
}

const contextsOf = (commits: Connection<{ commit: CommitNode }> | undefined) =>
  commits?.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];

/** `gh pr checks`' buckets: cancelled is `cancel`, skipped and neutral are `skipping`. */
function prCheck(c: GqlContext): typeof Git.PrCheck.Type {
  const check = rollupCheck(c);
  const isCancelled =
    c.__typename === 'CheckRun' && c.conclusion === 'CANCELLED';
  return {
    ...check,
    state: isCancelled
      ? 'cancel'
      : check.state === 'skip'
        ? 'skipping'
        : check.state,
  };
}

// Auto-fix

const AUTOFIX = `fragment Autofix on PullRequest {
  state url headRefOid mergeable
  commits(last: 1) { nodes { commit { ...Checks } } }
  comments(last: 50) { nodes { databaseId author { login } body url } }
  reviews(last: 50) { nodes { databaseId author { login } body url } }
  reviewThreads(last: 50) { nodes { isResolved path line comments(last: 20) { nodes { databaseId author { login } body url } } } }
}`;

type GqlComment = {
  databaseId: number;
  author: { login: string } | null;
  body: string;
  url?: string;
};
export type GqlContext =
  | {
      __typename: 'CheckRun';
      name: string;
      status: string;
      conclusion: string | null;
      detailsUrl?: string;
    }
  | {
      __typename: 'StatusContext';
      context: string;
      state: string;
      targetUrl?: string | null;
    };
type AutofixNode = {
  state: AutofixSnapshot['state'];
  url: string;
  headRefOid: string;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  commits: Connection<{ commit: CommitNode }>;
  comments: Connection<GqlComment>;
  reviews: Connection<GqlComment>;
  reviewThreads: Connection<{
    isResolved: boolean;
    path: string;
    line: number | null;
    comments: Connection<GqlComment>;
  }>;
};

const FAILED = new Set([
  'FAILURE',
  'TIMED_OUT',
  'STARTUP_FAILURE',
  'ACTION_REQUIRED',
  'ERROR',
]);
const SKIPPED = new Set(['CANCELLED', 'SKIPPED', 'NEUTRAL', 'STALE']);

/**
 * The PR → a snapshot. Reviews with no text (a bare approval) and resolved threads are left out, and so is what `viewer` (the
 * account Mochi reads as) wrote: the agent's own replies on the PR would otherwise come back as review events.
 */
export function toAutofix(
  pr: AutofixNode,
  viewer: string | undefined,
): AutofixSnapshot {
  const isOthers = (c: GqlComment) =>
    !!c.body.trim() && c.author?.login !== viewer;
  const inline = pr.reviewThreads.nodes
    .filter((t) => !t.isResolved)
    .flatMap((t) =>
      t.comments.nodes
        .filter(isOthers)
        .map((c) => comment(c, `${t.path}${t.line ? `:${t.line}` : ''}`)),
    );
  return {
    state: pr.state,
    url: pr.url,
    head: pr.headRefOid,
    isConflicting: pr.mergeable === 'CONFLICTING',
    checks: contextsOf(pr.commits).map(rollupCheck),
    comments: [...pr.comments.nodes, ...pr.reviews.nodes]
      .filter(isOthers)
      .map((c) => comment(c))
      .concat(inline),
  };
}

/** One context of a commit's `statusCheckRollup` as a check. */
export function rollupCheck(c: GqlContext): AutofixCheck {
  if (c.__typename === 'StatusContext')
    return {
      name: c.context,
      state:
        c.state === 'SUCCESS'
          ? 'pass'
          : FAILED.has(c.state)
            ? 'fail'
            : 'pending',
      link: c.targetUrl ?? undefined,
    };
  const state =
    c.status !== 'COMPLETED'
      ? 'pending'
      : FAILED.has(c.conclusion ?? '')
        ? 'fail'
        : SKIPPED.has(c.conclusion ?? '')
          ? 'skip'
          : 'pass';
  return { name: c.name, state, link: c.detailsUrl };
}

const comment = (c: GqlComment, where?: string): AutofixComment => ({
  id: String(c.databaseId),
  author: c.author?.login ?? 'ghost',
  body: c.body,
  ...(c.url && { url: c.url }),
  ...(where && { where }),
});

// ref chips

/** `issueOrPullRequest` answers `#n` without knowing which it is. */
const REF = `fragment Ref on IssueOrPullRequest {
  __typename
  ... on PullRequest {
    title url state isDraft mergeable reviewDecision updatedAt author { login avatarUrl(size: 40) } headRefName baseRefName additions deletions changedFiles autoMergeRequest { enabledAt }
    repository { squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed }
    commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 0) { totalCount checkRunCountsByState { state count } statusContextCountsByState { state count } } } } } }
  }
  ... on Issue { title url state stateReason updatedAt author { login avatarUrl(size: 40) } }
}`;

type RefNode = {
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
  repository?: MergeAllowed;
  commits?: Connection<{ commit: { statusCheckRollup: Rollup | null } }>;
};

type MergeAllowed = {
  squashMergeAllowed: boolean;
  mergeCommitAllowed: boolean;
  rebaseMergeAllowed: boolean;
};

/** The repository's allowed merge methods, in GitHub's order. */
export const allowedMethods = (repo: MergeAllowed): Git.MergeMethod[] =>
  (
    [
      repo.squashMergeAllowed && 'squash',
      repo.mergeCommitAllowed && 'merge',
      repo.rebaseMergeAllowed && 'rebase',
    ] as const
  ).filter((m) => !!m);

type Counts = { state: string; count: number }[];
type Rollup = {
  state: string;
  contexts?: {
    totalCount: number;
    checkRunCountsByState?: Counts;
    statusContextCountsByState?: Counts;
  };
};

/** "3/5": check runs that succeeded, were skipped or neutral, and commit statuses that succeeded, out of every check; with the failed and running ones. */
function checkCounts(
  rollup: Rollup | null | undefined,
): Git.RefState['checkCounts'] {
  const contexts = rollup?.contexts;
  if (!contexts?.totalCount) return null;
  const sum = (counts: Counts | undefined, states: string[]) =>
    (counts ?? []).reduce(
      (n, c) => n + (states.includes(c.state) ? c.count : 0),
      0,
    );
  const runs = contexts.checkRunCountsByState;
  const statuses = contexts.statusContextCountsByState;
  return {
    passed:
      sum(runs, ['SUCCESS', 'SKIPPED', 'NEUTRAL']) + sum(statuses, ['SUCCESS']),
    failed: sum(runs, [...FAILED]) + sum(statuses, ['FAILURE', 'ERROR']),
    running:
      sum(runs, ['IN_PROGRESS', 'PENDING', 'QUEUED', 'WAITING']) +
      sum(statuses, ['PENDING', 'EXPECTED']),
    total: contexts.totalCount,
  };
}

export function toRefState(node: RefNode): Git.RefState {
  const isPr = node.__typename === 'PullRequest';
  const rollup = node.commits?.nodes[0]?.commit.statusCheckRollup;
  const status =
    node.state === 'MERGED'
      ? 'merged'
      : node.state === 'CLOSED'
        ? 'closed'
        : node.isDraft
          ? 'draft'
          : 'open';
  return {
    kind: isPr ? 'pr' : 'issue',
    status,
    title: node.title,
    url: node.url,
    hasConflicts: status === 'open' && node.mergeable === 'CONFLICTING',
    isAutoMerge: !!node.autoMergeRequest,
    checks: (rollup ? CHECKS_STATE[rollup.state] : null) ?? null,
    checkCounts: checkCounts(rollup),
    mergeMethods: node.repository ? allowedMethods(node.repository) : null,
    review: (node.reviewDecision && REVIEWS[node.reviewDecision]) ?? null,
    isNotPlanned: node.stateReason === 'NOT_PLANNED',
    author: node.author ?? null,
    updatedAt: node.updatedAt ?? null,
    branch:
      isPr && node.headRefName && node.baseRefName
        ? { head: node.headRefName, base: node.baseRefName }
        : null,
    diff:
      isPr && node.additions !== undefined
        ? {
            added: node.additions,
            removed: node.deletions ?? 0,
            files: node.changedFiles ?? 0,
          }
        : null,
  };
}

const CHECKS_STATE: Record<string, Git.RefState['checks'] | undefined> = {
  SUCCESS: 'pass',
  FAILURE: 'fail',
  ERROR: 'fail',
  PENDING: 'pending',
  EXPECTED: 'pending',
};
const REVIEWS = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes',
  REVIEW_REQUIRED: 'required',
} satisfies Record<
  NonNullable<RefNode['reviewDecision']>,
  Git.RefState['review']
>;

// open PRs

const OPEN_PR = `fragment OpenPr on PullRequest { number title headRefName headRefOid labels(first: 20) { nodes { name } } commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
  __typename
  ... on CheckRun { status conclusion }
  ... on StatusContext { state }
} } } } } } }`;

type OpenNode = {
  number: number;
  title: string;
  headRefName: string;
  headRefOid: string;
  labels: Connection<{ name: string }>;
  commits: Connection<{
    commit: {
      statusCheckRollup: {
        contexts: Connection<
          | {
              __typename: 'CheckRun';
              status: string;
              conclusion: string | null;
            }
          | { __typename: 'StatusContext'; state: string }
        >;
      } | null;
    };
  }>;
};

/** `gh pr list --json statusCheckRollup` gave a check run's `status` as `state` beside its `conclusion`. */
function toOpenPr(n: OpenNode, isReviewRequested: boolean): OpenPr {
  const contexts =
    n.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  return {
    number: n.number,
    title: n.title,
    headRefName: n.headRefName,
    headRefOid: n.headRefOid,
    labels: n.labels.nodes,
    statusCheckRollup: contexts.map((c) =>
      c.__typename === 'CheckRun'
        ? { conclusion: c.conclusion, state: c.status }
        : { state: c.state },
    ),
    isReviewRequested,
  };
}
