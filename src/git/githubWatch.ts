import {
  experimental_streamedQuery as streamedQuery,
  useQuery,
} from '@tanstack/react-query';
import { Effect, Stream } from 'effect';
import type { CoreClient } from '@mochi/core/client';
import { currentPr } from '@mochi/core/github/nodes';
import type { BranchPrs } from '@mochi/core/github/schema';
import { host } from '../host/index.ts';
import { coreClient } from '../host/desktop/rpc.ts';
import { queryKeys } from '../queryKeys.ts';
import { gitError } from './useGit.ts';

/**
 * A query fed by one of Core's GitHub streams: each value replaces the last, and the last observer unmounting ends the subscription.
 * Core polls the repository (one request for every surface on it), so nothing here refetches.
 */
export function githubStreamQuery<A>(
  open: (client: CoreClient) => Stream.Stream<A, unknown>,
) {
  return {
    queryFn: streamedQuery<A, A | null>({
      streamFn: async ({ signal }) => {
        const aborted = Effect.callback<void>((resume) =>
          signal.addEventListener('abort', () => resume(Effect.void), {
            once: true,
          }),
        );
        const stream = open(await coreClient()).pipe(
          Stream.interruptWhen(aborted),
          Stream.mapError(
            (error) =>
              new Error(
                typeof error === 'string'
                  ? error
                  : error instanceof Error
                    ? error.message
                    : String(error),
              ),
          ),
        );
        return Stream.toAsyncIterable(stream);
      },
      reducer: (_, value) => value,
      initialValue: null,
      // A resubscribe keeps showing the last value until Core sends the current one.
      refetchMode: 'append',
    }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  };
}

/** The branch's PR as `gh pr view` picks it: the open one, else the newest. */
export function useBranchPr(cwd: string, githubUser: string | undefined) {
  const prsQuery = useQuery(branchPrsQuery(cwd, githubUser));
  return {
    pr: prsQuery.data ? currentPr(prsQuery.data.prs) : null,
    error: prsQuery.error ? gitError(prsQuery.error) : undefined,
    isPending: prsQuery.isPending,
  };
}

/** The worktree's branch PRs (ShipBar, PR sync). The web build has no Core: it reads `host.git.pr` once. */
export function branchPrsQuery(cwd: string, githubUser: string | undefined) {
  const queryKey = queryKeys.git.branchPrs(cwd, githubUser);
  if (!host.isDesktop)
    return {
      queryKey,
      queryFn: async (): Promise<BranchPrs | null> =>
        webBranchPrs(await host.git.pr(cwd, githubUser)),
    };
  return {
    queryKey,
    ...githubStreamQuery((client) => client['github.pr']({ cwd, githubUser })),
  };
}

const webBranchPrs = (
  pr: Awaited<ReturnType<typeof host.git.pr>>,
): BranchPrs => ({
  branch: '',
  prs: pr
    ? [
        {
          ...pr,
          state:
            pr.state === 'MERGED' || pr.state === 'CLOSED' ? pr.state : 'OPEN',
          isDraft: false,
        },
      ]
    : [],
});

/** Core reads the repository now; after a push it keeps reading it fast while CI runs and the PR opens. */
export function refreshGithub(target: {
  cwd?: string;
  ref?: { owner: string; repo: string; number: number };
  githubUser?: string;
  isPush: boolean;
}) {
  if (!host.isDesktop) return;
  void coreClient().then((client) =>
    Effect.runPromise(client['github.refresh'](target)),
  );
}
