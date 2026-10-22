import { Schema } from 'effect';
import { ArrayOf, invoke, Str } from '../checks.ts';
import { Provider } from '../model.ts';
import { GithubUser } from './projects.ts';

const S = Schema.String;
const N = Schema.Number;

const Paths = ArrayOf(Str(), 512);

export const UsageQuery = Schema.Struct({
  roots: Paths,
  repos: Paths,
  since: Schema.NullOr(Schema.Finite),
  githubUser: Schema.optional(GithubUser),
});
export type UsageQuery = typeof UsageQuery.Type;

export const CostParts = Schema.Struct({ input: N, output: N, cacheRead: N, cacheWrite: N });
export type CostParts = typeof CostParts.Type;

export const TokenBucket = Schema.Struct({
  day: S,
  harness: Provider,
  model: S,
  root: S,
  input: N,
  output: N,
  cacheRead: N,
  cacheWrite5m: N,
  cacheWrite1h: N,
  cost: Schema.NullOr(CostParts),
  uncached: Schema.NullOr(N),
});
export type TokenBucket = typeof TokenBucket.Type;

export const UsageSession = Schema.Struct({ harness: Provider, root: S, id: S });
export type UsageSession = typeof UsageSession.Type;

export const CommitStat = Schema.Struct({ repo: S, at: N, added: N, removed: N, isMerge: Schema.Boolean });
export type CommitStat = typeof CommitStat.Type;

export const PrStat = Schema.Struct({ repo: S, number: N, state: Schema.Literals(['OPEN', 'MERGED', 'CLOSED']), createdAt: N, mergedAt: Schema.NullOr(N) });
export type PrStat = typeof PrStat.Type;

export const UsageReport = Schema.Struct({
  tokens: Schema.Array(TokenBucket),
  sessions: Schema.Array(UsageSession),
  commits: Schema.Array(CommitStat),
  prs: Schema.Array(PrStat),
  errors: Schema.Array(S),
});
export type UsageReport = typeof UsageReport.Type;

export const usageRpc = {
  report: invoke(Schema.Tuple([UsageQuery]), UsageReport),
};
