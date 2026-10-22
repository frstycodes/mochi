import { useQueries, useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { host } from '@/host';
import { refKey, type GithubRef, type RefState } from './refs';

type Scope = { cwd: string | null; githubUser?: string };
type Request = { ref: GithubRef; scope: Scope; resolve: (state: RefState | null) => void; reject: (error: unknown) => void };
const queued: Request[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

export function useRefState(ref: GithubRef, scope: Scope) {
  return useRefStates([ref], scope)[0];
}

export function useRefStates(refs: GithubRef[], scope: Scope) {
  return useQueries({ queries: refs.map((ref) => refQuery(ref, scope)) }).map((result) => result.data);
}

export function patchRef(ref: GithubRef, patch: Partial<RefState>, at?: number) {
  queryClient.setQueriesData<RefState | null>({ queryKey: queryKeys.chat.githubRef.ref(refKey(ref)) }, (state) => state && { ...state, ...patch }, at === undefined ? undefined : { updatedAt: at });
}

export function refreshRef(ref: GithubRef, scope: Scope, expected?: Partial<RefState>) {
  patchRef(ref, expected ?? {}, 0);
  void queryClient.invalidateQueries({ queryKey: refQuery(ref, scope).queryKey });
  void queryClient.fetchQuery(refQuery(ref, scope)).catch(() => {});
}

function refQuery(ref: GithubRef, scope: Scope) {
  return { queryKey: queryKeys.chat.githubRef.scoped(refKey(ref), scope.cwd, scope.githubUser), staleTime: 60_000,
    refetchOnWindowFocus: (query: { state: { dataUpdatedAt: number } }) => Date.now() - query.state.dataUpdatedAt > 10_000 ? 'always' as const : false,
    queryFn: () => new Promise<RefState | null>((resolve, reject) => {
      queued.push({ ref, scope, resolve, reject });
      timer ??= setTimeout(flush, 40);
    }),
  };
}

function flush() {
  timer = undefined;
  const batches = new Map<string, Request[]>();
  for (const request of queued.splice(0)) {
    const key = JSON.stringify(request.scope);
    const batch = batches.get(key) ?? [];
    batch.push(request);
    batches.set(key, batch);
  }
  for (const requests of batches.values()) {
    const { scope } = requests[0];
    void host.git.refStates(scope.cwd, requests.map((r) => r.ref), scope.githubUser).then(
      (states) => requests.forEach((r) => r.resolve(states[refKey(r.ref)] ?? null)),
      (error: unknown) => requests.forEach((r) => r.reject(error)),
    );
  }
}

export function useRepoSlug(cwd: string | null) {
  const slugQuery = useQuery({ queryKey: queryKeys.chat.repoSlug(cwd), queryFn: () => host.git.repoSlug(cwd!), enabled: !!cwd, staleTime: Infinity });
  return slugQuery.data ?? null;
}
