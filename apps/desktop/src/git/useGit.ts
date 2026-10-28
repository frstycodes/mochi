import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../toast/store.ts';
import { host } from '../host/index.ts';
import type { DiffScope, GitDiff } from '../host/types/git.ts';
import { queryKeys } from '../queryKeys.ts';
import { useWatchQuery } from '../watch/useWatchQuery.ts';
import { askMachine, remoteQuery, type ThreadIo } from '../remote/threadIo.ts';

const PR_POLL_MS = 30_000;
const REMOTE_DIFF_POLL_MS = 4000;

/** The worktree's diff (against `base`, the thread's chosen base), pushed by Core when the worktree's git status moves; none without `cwd`. */
export function useGitDiff(
  cwd: string | null,
  scope: DiffScope,
  base?: string,
) {
  const [diffQuery, refresh] = useWatchQuery(
    queryKeys.git.diff(cwd ?? '', scope, base),
    cwd ? { _tag: 'gitDiff', cwd, scope, base } : null,
    (value) => value.diff as GitDiff,
    () => host.git.diff(cwd!, scope, base),
  );
  return { ...gitResult(diffQuery), refresh };
}

/** What the thread's diff compares: its changes by `scope` (against `base` here), or as they stood at checkpoint `n`. */
export type DiffTarget =
  | { scope: DiffScope; base?: string; checkpoint?: undefined }
  | { checkpoint: number; scope?: undefined; base?: undefined };

/**
 * The thread's diff wherever it runs: Core's watch on this computer's worktree, or its owner's answer polled every few seconds.
 * A checkpoint's diff is what the thread had changed then, so it's read once.
 */
export function useThreadDiff(
  io: ThreadIo,
  threadId: string,
  target: DiffTarget,
) {
  const root = io.kind === 'local' ? io.root : null;
  const n = target.checkpoint;
  const live = useGitDiff(
    n === undefined ? root : null,
    target.scope ?? 'branch',
    target.base,
  );
  const checkpointQuery = useQuery({
    queryKey: queryKeys.git.checkpointDiff(root, threadId, n ?? -1),
    queryFn: () => host.git.checkpointDiff(root!, threadId, n!),
    enabled: !!root && n !== undefined,
  });
  const remoteDiffQuery = useQuery(
    remoteQuery(
      io,
      n === undefined ? ['diff', target.scope] : ['checkpoint-diff', n],
      ({ machine, threadId: id }) =>
        n === undefined
          ? askMachine(machine.id, {
              type: 'diff',
              threadId: id,
              scope: target.scope ?? 'branch',
            })
          : askMachine(machine.id, {
              type: 'checkpoint-diff',
              threadId: id,
              n,
            }),
      n === undefined ? REMOTE_DIFF_POLL_MS : undefined,
    ),
  );
  if (io.kind === 'remote') {
    const result = gitResult(remoteDiffQuery);
    return {
      ...result,
      isLoading: io.machine.status === 'online' && result.isLoading,
    };
  }
  return n === undefined ? live : gitResult(checkpointQuery);
}

/** The project's branches, read once per root; `refresh` re-reads them. */
export function useBranches(root: string) {
  const branchesQuery = useQuery({
    queryKey: queryKeys.git.branches(root),
    queryFn: () => host.git.branches(root),
    enabled: !!root,
  });
  return {
    list: branchesQuery.data,
    error: branchesQuery.error?.message,
    refresh: () => {
      void branchesQuery.refetch();
    },
  };
}

/** `githubUser` is the thread's profile GitHub account; gh's active account when undefined. */
export function usePr(cwd: string, githubUser?: string) {
  return gitResult(
    useQuery({
      queryKey: queryKeys.git.pr(cwd, githubUser),
      queryFn: () => host.git.pr(cwd, githubUser),
      refetchInterval: host.isDesktop ? PR_POLL_MS : false,
    }),
  );
}

/** One PR's review page, re-read like `usePr`. */
export function usePrReview(cwd: string, pr: number, githubUser?: string) {
  return gitResult(
    useQuery({
      queryKey: queryKeys.git.review(cwd, pr, githubUser),
      queryFn: () => host.git.prReview(cwd, pr, githubUser),
      refetchInterval: host.isDesktop ? PR_POLL_MS : false,
    }),
  );
}

function gitResult<T>(result: UseQueryResult<T>) {
  return {
    data: result.data,
    error: result.error ? gitError(result.error) : undefined,
    isLoading: result.isPending,
    refresh: async () => {
      await result.refetch();
    },
  };
}

/** Runs a git action, reports failures as a toast and refreshes afterwards. Resolves to the action's result, or undefined when it failed. */
export function useGitAction(refresh: () => Promise<void>) {
  const [pending, setPending] = useState<string | null>(null);
  const run = async <T>(label: string, action: () => Promise<T>) => {
    setPending(label);
    try {
      return await action();
    } catch (error) {
      toast.error(`${label} failed`, { description: gitError(error) });
    } finally {
      setPending(null);
      await refresh();
    }
  };
  return { run, pending };
}

// Electron wraps main-process errors as "Error invoking remote method 'git:diff': Error: …".
export function gitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /^Error invoking remote method '[^']+': (\w*Error: )?/,
    '',
  );
}
