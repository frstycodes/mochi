import { Effect, Stream } from 'effect';
import type { Git } from '@mochi/schema';
import type { GitHub, GithubError } from './service.ts';

// The refs one chat message can ask for at once.
const MAX_REFS = 50;

const message = (error: GithubError) => error.message;

/** `github.*` streams, plus the `host.git` reads that were main's `gh pr view`/`gh pr list`/`gh api graphql` and are now Core's. */
export const githubHandlers = (github: GitHub['Service']) => ({
  'github.pr': ({ cwd, githubUser }: { cwd: string; githubUser?: string }) =>
    Stream.mapError(github.watchPr(cwd, githubUser), message),
  'github.ci': ({
    cwd,
    githubUser,
    pr,
  }: {
    cwd: string;
    githubUser?: string;
    pr: number;
  }) => Stream.mapError(github.watchCi(cwd, pr, githubUser), message),
  'github.ref': ({
    ref,
    githubUser,
  }: {
    ref: Git.GithubRef;
    githubUser?: string;
  }) => Stream.mapError(github.watchRef(ref, githubUser), message),
  'github.openPrs': ({
    cwd,
    githubUser,
    isReviewRequested,
  }: {
    cwd: string;
    githubUser?: string;
    isReviewRequested: boolean;
  }) =>
    Stream.mapError(
      github.watchOpenPrs(cwd, isReviewRequested, githubUser),
      message,
    ),
  'github.authoredPrs': ({
    cwd,
    githubUser,
    since,
  }: {
    cwd: string;
    githubUser?: string;
    since: number | null;
  }) => Effect.mapError(github.authoredPrs(cwd, since, githubUser), message),
  // A repository that can't be read has nothing polling it to wake.
  'github.refresh': (target: {
    cwd?: string;
    ref?: Git.GithubRef;
    githubUser?: string;
    isPush: boolean;
  }) => Effect.ignore(github.refresh(target)),

  'git.pr': ([cwd, githubUser]: readonly [string, string | undefined]) =>
    Effect.mapError(github.pr(cwd, githubUser), message),
  // No gh login, offline, or a folder that isn't a GitHub checkout reads as no PRs (`GitHost.worktreePrs`).
  'git.worktreePrs': ([worktrees, githubUser]: readonly [
    ReadonlyArray<string>,
    string | undefined,
  ]) => github.worktreePrs(worktrees.slice(0, MAX_REFS), githubUser),
  'git.refStates': ([, refs, githubUser]: readonly [
    string | null,
    ReadonlyArray<Git.GithubRef>,
    string | undefined,
  ]) => github.refStates(refs.slice(0, MAX_REFS), githubUser),
});
