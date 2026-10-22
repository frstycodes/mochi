import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from '../toast/store.ts';
import { host } from '../host/index.ts';
import type { DiffScope } from '../host/types/git.ts';
import { queryKeys } from '../queryKeys.ts';

const DIFF_POLL_MS = 4000;
const PR_POLL_MS = 30_000;

/** The worktree's diff (against `base`, the thread's chosen base), re-read on an interval and on window focus while the agent keeps editing. */
export function useGitDiff(cwd: string, scope: DiffScope, base?: string) {
  return gitResult(useQuery({ queryKey: queryKeys.git.diff(cwd, scope, base), queryFn: () => host.git.diff(cwd, scope, base), refetchInterval: host.isDesktop ? DIFF_POLL_MS : false }));
}

/** The project's branches, read once per root; `refresh` re-reads them. */
export function useBranches(root: string) {
  const branchesQuery = useQuery({ queryKey: queryKeys.git.branches(root), queryFn: () => host.git.branches(root), enabled: !!root });
  return { list: branchesQuery.data, error: branchesQuery.error?.message, refresh: () => { void branchesQuery.refetch(); } };
}

/** `githubUser` is the thread's profile GitHub account; gh's active account when undefined. */
export function usePr(cwd: string, githubUser?: string) {
  return gitResult(useQuery({ queryKey: queryKeys.git.pr(cwd, githubUser), queryFn: () => host.git.pr(cwd, githubUser), refetchInterval: host.isDesktop ? PR_POLL_MS : false }));
}

/** One PR's review page, re-read like `usePr`. */
export function usePrReview(cwd: string, pr: number, githubUser?: string) {
  return gitResult(useQuery({ queryKey: queryKeys.git.review(cwd, pr, githubUser), queryFn: () => host.git.prReview(cwd, pr, githubUser), refetchInterval: host.isDesktop ? PR_POLL_MS : false }));
}

function gitResult<T>(result: UseQueryResult<T>) {
  return { data: result.data, error: result.error ? gitError(result.error) : undefined, isLoading: result.isPending, refresh: async () => { await result.refetch(); } };
}

/** Runs a git action, reports failures as a toast and refreshes afterwards. Resolves to the action's result, or undefined when it failed. */
export function useGitAction(refresh: () => Promise<void>) {
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(
    async <T>(label: string, action: () => Promise<T>) => {
      setPending(label);
      try {
        return await action();
      } catch (error) {
        toast.error(`${label} failed`, { description: gitError(error) });
      } finally {
        setPending(null);
        await refresh();
      }
    },
    [refresh],
  );
  return { run, pending };
}

// Electron wraps main-process errors as "Error invoking remote method 'git:diff': Error: …".
export function gitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
}
