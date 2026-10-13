import type { GithubRef, RefState } from '../chat/refs.ts';
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
  ... on PullRequest { title url state isDraft mergeable commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
  ... on Issue { title url state stateReason }
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
  commits?: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
};

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
  const rollup = node.commits?.nodes[0]?.commit.statusCheckRollup?.state;
  const status = node.state === 'MERGED' ? 'merged' : node.state === 'CLOSED' ? 'closed' : node.isDraft ? 'draft' : 'open';
  return {
    kind: isPr ? 'pr' : 'issue',
    status,
    title: node.title,
    url: node.url,
    hasConflicts: status === 'open' && node.mergeable === 'CONFLICTING',
    isFailing: rollup === 'FAILURE' || rollup === 'ERROR',
    isNotPlanned: node.stateReason === 'NOT_PLANNED',
  };
}
