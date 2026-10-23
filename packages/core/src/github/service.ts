import { Context, Data, Effect, Exit, Fiber, Layer, Queue, Request, RequestResolver, Schedule, Stream, type Cause } from 'effect';
import { graphql, GraphqlResponseError } from '@octokit/graphql';
import type { Git } from '@mochi/schema';
import { Run } from '../run.ts';
import { GITHUB_COM, parseGithubAccount, parseRemote } from './account.ts';
import { buildQuery, currentPr, isIssueNumber, refKey, toPullRequest, type Ask } from './nodes.ts';
import type { AuthoredPr, AutofixSnapshot, BranchPrs, OpenPr } from './schema.ts';

export class GithubError extends Data.TaggedError('GithubError')<{ readonly message: string; readonly status?: number }> {}

/** A repository read as one account; `login` unset reads as gh's active account on `host`. */
export interface Repo {
  readonly host: string;
  readonly owner: string;
  readonly name: string;
  readonly login?: string;
}

const repoKey = (r: Repo) => `${r.host}/${r.owner}/${r.name}#${r.login ?? ''}`;

// Fast for ~10 minutes after a push (CI runs, the PR opens), then backing off to every 10 minutes.
const FAST = '30 seconds';
const FAST_WINDOW = '10 minutes';
const BACKOFF_START = '1 minute';
const SLOWEST = '10 minutes';
// Surfaces mounting together (a thread's chips, ShipBar, PR sync) land in the same poll.
const COALESCE_MS = 50;

export const settledCadence = Schedule.min([Schedule.exponential(BACKOFF_START), Schedule.spaced(SLOWEST)]);
export const pushCadence = Schedule.concat(Schedule.max([Schedule.spaced(FAST), Schedule.during(FAST_WINDOW)]), settledCadence);

/** GraphQL over HTTPS as an account. Tests swap it for a fake that counts requests. */
export class GithubTransport extends Context.Service<
  GithubTransport,
  { readonly query: (account: { host: string; login?: string }, query: string, variables: Record<string, string>) => Effect.Effect<unknown, GithubError> }
>()('mochi/core/GithubTransport') {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const { run } = yield* Run;
      // Tokens stay in Core's memory: read from gh's own store per login, sent only in the Authorization header.
      const tokens = new Map<string, string>();
      const tokenFor = (host: string, login: string | undefined) => {
        const key = `${host}/${login ?? ''}`;
        const cached = tokens.get(key);
        if (cached) return Effect.succeed({ key, token: cached });
        return run('gh', ['auth', 'token', '--hostname', host, ...(login ? ['--user', login] : [])], { queue: 'gh' }).pipe(
          Effect.map(({ stdout }) => stdout.trim()),
          Effect.filterOrFail((token) => !!token, () => new GithubError({ message: '' })),
          Effect.mapError(() => new GithubError({ message: `gh has no working login for ${login ?? 'its active account'} on ${host}. Sign in with gh auth login, or pick another GitHub account in Settings › Profiles.` })),
          Effect.tap((token) => Effect.sync(() => tokens.set(key, token))),
          Effect.map((token) => ({ key, token })),
        );
      };
      const query = (account: { host: string; login?: string }, text: string, variables: Record<string, string>) =>
        Effect.flatMap(tokenFor(account.host, account.login), ({ key, token }) =>
          Effect.tryPromise({
            try: (signal) => graphql(text, { ...variables, baseUrl: apiUrl(account.host), headers: { authorization: `token ${token}` }, request: { signal } }),
            catch: (error) => error,
          }).pipe(
            // A ref GitHub can't resolve fails its field and still answers the rest.
            Effect.catch((error) => (error instanceof GraphqlResponseError && error.data ? Effect.succeed(error.data as unknown) : Effect.fail(asGithubError(error)))),
            // A revoked or rotated token: the next poll reads gh's store again.
            Effect.tapError((error) => Effect.sync(() => error.status === 401 && tokens.delete(key))),
          ),
        );
      return { query };
    }),
  );
}

function apiUrl(host: string) {
  if (host === GITHUB_COM) return 'https://api.github.com';
  return host.endsWith('.ghe.com') ? `https://api.${host}` : `https://${host}/api`;
}

function asGithubError(error: unknown) {
  const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  return new GithubError({ message: error instanceof Error ? error.message : String(error), status });
}

const AUTHORED_LIMIT = 1000;
const AUTHORED_QUERY = (isNext: boolean) =>
  `query($q: String!${isNext ? ', $after: String!' : ''}) { search(query: $q, type: ISSUE, first: 100${isNext ? ', after: $after' : ''}) { pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { number state createdAt mergedAt } } } }`;
type AuthoredPage = { search: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: (AuthoredPr | Record<string, never>)[] } };

class RepoAsk extends Request.Class<{ readonly repo: Repo; readonly ask: Ask }, unknown, GithubError> {}

interface Sub {
  /** Re-read each poll: a worktree's branch can change under it. */
  readonly ask: Effect.Effect<Ask, GithubError>;
  readonly queue: Queue.Queue<unknown, GithubError | Cause.Done>;
}

interface Poller {
  readonly subs: Set<Sub>;
  /** `true` is a push. */
  readonly wake: Queue.Queue<boolean>;
  fiber?: Fiber.Fiber<unknown>;
}

/**
 * GitHub for every surface: PR, check-run and issue reads are `Request`s, and one resolver batches each poll's requests per
 * repository and account into one GraphQL request. A repository is polled while anything watches it.
 */
export class GitHub extends Context.Service<GitHub>()('mochi/core/GitHub', {
  make: Effect.gen(function* () {
    const { run } = yield* Run;
    const transport = yield* GithubTransport;

    const resolver = RequestResolver.makeGrouped<RepoAsk, string>({
      key: ({ request }) => repoKey(request.repo),
      resolver: (entries) => {
        const { repo } = entries[0].request;
        const { query, variables, parse } = buildQuery(repo.owner, repo.name, entries.map((e) => e.request.ask));
        return transport.query({ host: repo.host, login: repo.login }, query, variables).pipe(
          Effect.map((data) => entries.forEach((entry, i) => entry.completeUnsafe(Exit.succeed(parse((data ?? {}) as never, i))))),
          Effect.catch((error) => Effect.sync(() => entries.forEach((entry) => entry.completeUnsafe(Exit.fail(error))))),
        );
      },
    });
    const request = (repo: Repo, ask: Ask) => Effect.request(new RepoAsk({ repo, ask }), resolver);

    const git = (cwd: string, args: string[]) =>
      run('git', args, { cwd }).pipe(
        Effect.map(({ stdout }) => stdout.trim()),
        Effect.mapError((error) => new GithubError({ message: error instanceof Error ? error.message : String(error) })),
      );

    const repoOf = (cwd: string, githubUser: string | undefined) =>
      Effect.gen(function* () {
        const url = yield* git(cwd, ['remote', 'get-url', 'origin']).pipe(Effect.orElseSucceed(() => ''));
        const remote = parseRemote(url);
        if (!remote) return yield* new GithubError({ message: `origin (${url || 'none'}) isn't a GitHub remote` });
        const [owner, name] = remote.path.split('/') as [string, string];
        const account = githubUser ? parseGithubAccount(githubUser) : null;
        if (githubUser && !account) return yield* new GithubError({ message: 'githubUser must be a GitHub login, or host/login for GitHub Enterprise' });
        if (account && account.host !== remote.host)
          return yield* new GithubError({ message: `This repository is on ${remote.host}, but the profile's GitHub account ${githubUser} is on ${account.host}. Pick a ${remote.host} account in Settings › Profiles.` });
        return { host: remote.host, owner, name, login: account?.login } satisfies Repo;
      });

    const branchAsk = (cwd: string) => Effect.map(git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']), (branch): Ask => ({ _tag: 'BranchPrs', branch }));

    /** A ref names its own repository on github.com; the profile's account reads it when that account is on github.com. */
    const refRepo = (ref: Git.GithubRef, githubUser: string | undefined): Repo => {
      const account = githubUser ? parseGithubAccount(githubUser) : null;
      return { host: GITHUB_COM, owner: ref.owner, name: ref.repo, login: account?.host === GITHUB_COM ? account.login : undefined };
    };
    const refAsk = (ref: Git.GithubRef) => (isIssueNumber(ref.number) ? Effect.succeed<Ask>({ _tag: 'Ref', number: ref.number }) : Effect.fail(new GithubError({ message: `#${ref.number} isn't an issue number` })));

    const pollers = new Map<string, Poller>();

    const cycle = (repo: Repo, poller: Poller) =>
      Effect.gen(function* () {
        const subs = [...poller.subs];
        // Every ask is resolved before any request is made, so they all land in one batch.
        const asks = yield* Effect.forEach(subs, (sub) => Effect.exit(sub.ask), { concurrency: 'unbounded' });
        const results = yield* Effect.forEach(asks, (ask) => (Exit.isSuccess(ask) ? Effect.exit(request(repo, ask.value)) : Effect.succeed(ask)), { concurrency: 'unbounded' });
        subs.forEach((sub, i) => {
          const result = results[i]!;
          if (Exit.isSuccess(result)) Queue.offerUnsafe(sub.queue, result.value);
          else Queue.failCauseUnsafe(sub.queue, result.cause);
        });
      });

    const loop = (repo: Repo, poller: Poller) =>
      Effect.gen(function* () {
        let step = yield* Schedule.toStepWithSleep(settledCadence);
        while (true) {
          const woke = yield* Effect.raceFirst(Effect.as(Effect.ignore(step(undefined)), false), Queue.take(poller.wake));
          yield* Effect.sleep(COALESCE_MS);
          const more = yield* Queue.clear(poller.wake);
          if (woke || more.includes(true)) step = yield* Schedule.toStepWithSleep(pushCadence);
          yield* cycle(repo, poller);
        }
      });

    const join = (repo: Repo, sub: Sub) =>
      Effect.gen(function* () {
        const key = repoKey(repo);
        let poller = pollers.get(key);
        if (!poller) {
          poller = { subs: new Set(), wake: yield* Queue.unbounded<boolean>() };
          pollers.set(key, poller);
          poller.fiber = yield* Effect.forkDetach(loop(repo, poller));
        }
        poller.subs.add(sub);
        Queue.offerUnsafe(poller.wake, false);
      });

    const leave = (repo: Repo, sub: Sub) =>
      Effect.gen(function* () {
        const key = repoKey(repo);
        const poller = pollers.get(key);
        if (!poller?.subs.delete(sub) || poller.subs.size > 0) return;
        pollers.delete(key);
        if (poller.fiber) yield* Fiber.interrupt(poller.fiber);
      });

    const watch = <A>(resolve: Effect.Effect<{ repo: Repo; ask: Effect.Effect<Ask, GithubError> }, GithubError>, toValue: (value: unknown) => A = (value) => value as A) =>
      Stream.callback<unknown, GithubError>((queue) =>
        Effect.gen(function* () {
          const { repo, ask } = yield* resolve;
          const sub: Sub = { ask, queue };
          yield* join(repo, sub);
          yield* Effect.addFinalizer(() => leave(repo, sub));
        }),
      ).pipe(
        Stream.map(toValue),
        Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      );

    const wake = (repo: Repo, isPush: boolean) => Effect.sync(() => pollers.get(repoKey(repo)) && Queue.offerUnsafe(pollers.get(repoKey(repo))!.wake, isPush));

    return {
      /** The worktree's branch PRs, as they change. */
      watchPr: (cwd: string, githubUser?: string) => watch<BranchPrs>(Effect.map(repoOf(cwd, githubUser), (repo) => ({ repo, ask: branchAsk(cwd) }))),
      watchCi: (cwd: string, pr: number, githubUser?: string) =>
        watch<AutofixSnapshot | null>(
          Effect.gen(function* () {
            if (!isIssueNumber(pr)) return yield* new GithubError({ message: `#${pr} isn't a PR number` });
            return { repo: yield* repoOf(cwd, githubUser), ask: Effect.succeed<Ask>({ _tag: 'PrDetail', number: pr }) };
          }),
        ),
      watchRef: (ref: Git.GithubRef, githubUser?: string) => watch<Git.RefState | null>(Effect.succeed({ repo: refRepo(ref, githubUser), ask: refAsk(ref) })),
      watchOpenPrs: (cwd: string, isReviewRequested: boolean, githubUser?: string) =>
        watch<ReadonlyArray<OpenPr>>(Effect.map(repoOf(cwd, githubUser), (repo) => ({ repo, ask: Effect.succeed<Ask>({ _tag: 'OpenPrs', isReviewRequested }) }))),
      /** Polls the repository now; a push also polls it fast for a while. A repository nothing watches is left alone. */
      refresh: (target: { cwd?: string; ref?: Git.GithubRef; githubUser?: string; isPush: boolean }) =>
        Effect.gen(function* () {
          if (target.ref) yield* wake(refRepo(target.ref, target.githubUser), target.isPush);
          if (target.cwd) yield* Effect.flatMap(repoOf(target.cwd, target.githubUser), (repo) => wake(repo, target.isPush));
        }),

      // One-shot reads (`host.git.*`), batched with whatever else asks at the same moment.
      pr: (cwd: string, githubUser?: string) =>
        Effect.gen(function* () {
          const repo = yield* repoOf(cwd, githubUser);
          const prs = (yield* request(repo, yield* branchAsk(cwd))) as BranchPrs;
          return currentPr(prs.prs);
        }),
      worktreePrs: (worktrees: ReadonlyArray<string>, githubUser?: string) =>
        Effect.gen(function* () {
          const targets = yield* Effect.forEach(worktrees, (worktree) => Effect.option(Effect.all({ repo: repoOf(worktree, githubUser), ask: branchAsk(worktree) })), { concurrency: 'unbounded' });
          const found = yield* Effect.forEach(targets, (target) => (target._tag === 'Some' ? Effect.option(request(target.value.repo, target.value.ask)) : Effect.succeedNone), { concurrency: 'unbounded' });
          return found.flatMap((prs, i) => (prs._tag === 'Some' ? (prs.value as BranchPrs).prs.map((pr) => ({ worktree: worktrees[i]!, pr: toPullRequest(pr) })) : []));
        }),
      /** Pages of 100 from GitHub's search, up to `AUTHORED_LIMIT`. */
      authoredPrs: (cwd: string, since: number | null, githubUser?: string) =>
        Effect.gen(function* () {
          const repo = yield* repoOf(cwd, githubUser);
          const created = since === null ? '' : ` created:>=${new Date(since).toISOString().slice(0, 10)}`;
          const q = `repo:${repo.owner}/${repo.name} is:pr author:@me sort:created-desc${created}`;
          const prs: AuthoredPr[] = [];
          let after: string | null = null;
          do {
            const data = (yield* transport.query({ host: repo.host, login: repo.login }, AUTHORED_QUERY(after !== null), { q, ...(after !== null && { after }) })) as AuthoredPage;
            prs.push(...data.search.nodes.filter((n): n is AuthoredPr => 'number' in n));
            after = data.search.pageInfo.hasNextPage ? data.search.pageInfo.endCursor : null;
          } while (after !== null && prs.length < AUTHORED_LIMIT);
          return prs;
        }),
      refStates: (refs: ReadonlyArray<Git.GithubRef>, githubUser?: string) =>
        Effect.gen(function* () {
          const states = yield* Effect.forEach(refs, (ref) => Effect.option(Effect.flatMap(refAsk(ref), (ask) => request(refRepo(ref, githubUser), ask))), { concurrency: 'unbounded' });
          // Refs GitHub didn't resolve (missing, no access, offline) are left out, so they stay unknown.
          return Object.fromEntries(refs.flatMap((ref, i) => (states[i]?._tag === 'Some' && states[i].value ? [[refKey(ref), states[i].value as Git.RefState]] : [])));
        }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

