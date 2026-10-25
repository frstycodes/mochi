import { useQueries, useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { host } from '@/host';
import { githubStreamQuery, refreshGithub } from '../git/githubWatch.ts';
import { refKey, type GithubRef, type RefState } from './refs';

type Scope = { cwd: string | null; githubUser?: string };

export function useRefState(ref: GithubRef, scope: Scope) {
  return useRefStates([ref], scope)[0];
}

/** Each chip watches its ref through Core, which reads every watched ref of a repository in one request per poll. */
export function useRefStates(refs: GithubRef[], scope: Scope) {
  return useQueries({ queries: refs.map((ref) => refQuery(ref, scope)) }).map(
    (result) => result.data,
  );
}

export function patchRef(
  ref: GithubRef,
  patch: Partial<RefState>,
  at?: number,
) {
  queryClient.setQueriesData<RefState | null>(
    { queryKey: queryKeys.chat.githubRef.ref(refKey(ref)) },
    (state) => state && { ...state, ...patch },
    at === undefined ? undefined : { updatedAt: at },
  );
}

/** Shows `expected` now and has Core read the ref's repository; its stream brings what GitHub says. */
export function refreshRef(
  ref: GithubRef,
  scope: Scope,
  expected?: Partial<RefState>,
) {
  patchRef(ref, expected ?? {}, 0);
  if (host.hasCore)
    return refreshGithub({ ref, githubUser: scope.githubUser, isPush: false });
  void queryClient.invalidateQueries({
    queryKey: refQuery(ref, scope).queryKey,
  });
}

function refQuery(ref: GithubRef, scope: Scope) {
  const queryKey = queryKeys.chat.githubRef.scoped(
    refKey(ref),
    scope.cwd,
    scope.githubUser,
  );
  if (!host.hasCore)
    return {
      queryKey,
      staleTime: 60_000,
      queryFn: async () =>
        (await host.git.refStates(scope.cwd, [ref], scope.githubUser))[
          refKey(ref)
        ] ?? null,
    };
  const { owner, repo, number } = ref;
  return {
    queryKey,
    ...githubStreamQuery((client) =>
      client['github.ref']({
        ref: { owner, repo, number },
        githubUser: scope.githubUser,
      }),
    ),
  };
}

export function useRepoSlug(cwd: string | null) {
  const slugQuery = useQuery({
    queryKey: queryKeys.chat.repoSlug(cwd),
    queryFn: () => host.git.repoSlug(cwd!),
    enabled: !!cwd,
    staleTime: Infinity,
  });
  return slugQuery.data ?? null;
}
