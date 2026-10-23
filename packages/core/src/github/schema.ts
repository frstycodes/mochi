import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { Git } from '@mochi/schema';

const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;

/** One PR whose head is the branch, with its head commit's checks. `state` is GitHub's, as `gh pr view` printed it. */
export const BranchPr = Schema.Struct({ number: N, url: S, title: S, state: Schema.Literals(['OPEN', 'MERGED', 'CLOSED']), isDraft: B, checks: Schema.Array(Git.PrCheck) });
export type BranchPr = typeof BranchPr.Type;

/** The worktree's branch and its PRs from this repository (not forks), newest first. */
export const BranchPrs = Schema.Struct({ branch: S, prs: Schema.Array(BranchPr) });
export type BranchPrs = typeof BranchPrs.Type;

export const AutofixCheckState = Schema.Literals(['pass', 'fail', 'pending', 'skip']);
export type AutofixCheckState = typeof AutofixCheckState.Type;

export const AutofixCheck = Schema.Struct({ name: S, state: AutofixCheckState, link: Schema.optional(S) });
export type AutofixCheck = typeof AutofixCheck.Type;

/** A PR comment, review or inline review-thread comment. Its text is third-party: quoted to the agent, never instructions. */
export const AutofixComment = Schema.Struct({
  id: S,
  author: S,
  body: S,
  url: Schema.optional(S),
  /** Inline comments: `path:line`. */
  where: Schema.optional(S),
});
export type AutofixComment = typeof AutofixComment.Type;

/** What Auto-fix reads of one PR: merge state, head checks, and others' comments. */
export const AutofixSnapshot = Schema.Struct({
  state: Schema.Literals(['OPEN', 'MERGED', 'CLOSED']),
  url: S,
  head: S,
  isConflicting: B,
  checks: Schema.Array(AutofixCheck),
  comments: Schema.Array(AutofixComment),
});
export type AutofixSnapshot = typeof AutofixSnapshot.Type;

/** An open PR as the scheduler's PR triggers read it; the shape `gh pr list --json` gave (`src/schedule/due.ts` `PrSnapshot`). */
export const OpenPr = Schema.Struct({
  number: N,
  title: S,
  headRefName: S,
  headRefOid: S,
  labels: Schema.Array(Schema.Struct({ name: S })),
  statusCheckRollup: Schema.Array(Schema.Struct({ conclusion: Schema.optional(Schema.NullOr(S)), state: Schema.optional(Schema.NullOr(S)) })),
  isReviewRequested: B,
});
export type OpenPr = typeof OpenPr.Type;

/** A PR you opened, for the usage report. */
export const AuthoredPr = Schema.Struct({ number: N, state: Schema.Literals(['OPEN', 'MERGED', 'CLOSED']), createdAt: S, mergedAt: Schema.NullOr(S) });
export type AuthoredPr = typeof AuthoredPr.Type;

const GithubUser = Schema.optional(S);
const Cwd = { cwd: S, githubUser: GithubUser };

/**
 * GitHub reads as streams: each emits the current value at once, then whenever a poll of its repository finds it changed.
 * Every subscription on one repository and account shares one GraphQL request per poll. A failure ends the stream with its message.
 */
export class GithubRpcs extends RpcGroup.make(
  /** The worktree's branch PRs (ShipBar, PR sync, CI notifications). */
  Rpc.make('github.pr', { payload: Cwd, success: BranchPrs, error: S, stream: true }),
  /** One PR as Auto-fix reads it; null once the PR isn't there. */
  Rpc.make('github.ci', { payload: { ...Cwd, pr: N }, success: Schema.NullOr(AutofixSnapshot), error: S, stream: true }),
  /** A PR or issue chip; null when GitHub didn't resolve it (missing, no access). */
  Rpc.make('github.ref', { payload: { ref: Git.GithubRef, githubUser: GithubUser }, success: Schema.NullOr(Git.RefState), error: S, stream: true }),
  /** The repository's open PRs, or those requesting your review (scheduler PR triggers). */
  Rpc.make('github.openPrs', { payload: { ...Cwd, isReviewRequested: B }, success: Schema.Array(OpenPr), error: S, stream: true }),
  /** PRs you opened in the repository, created on or after `since` (ms) when set; newest 1000. Not polled. */
  Rpc.make('github.authoredPrs', { payload: { ...Cwd, since: Schema.NullOr(N) }, success: Schema.Array(AuthoredPr), error: S }),
  /** Reads the repository now; `isPush` also polls it fast for the next ~10 minutes. */
  Rpc.make('github.refresh', { payload: { cwd: Schema.optional(S), ref: Schema.optional(Git.GithubRef), githubUser: GithubUser, isPush: B } }),
) {}
