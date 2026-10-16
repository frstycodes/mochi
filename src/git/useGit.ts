import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '../toast/store.ts';
import { host } from '../host/index.ts';
import type { DiffScope } from '../host/types/git.ts';

const DIFF_POLL_MS = 4000;
const PR_POLL_MS = 30_000;

/** The worktree's diff (against `base`, the thread's chosen base), re-read on an interval and on window focus while the agent keeps editing. */
export function useGitDiff(cwd: string, scope: DiffScope, base?: string) {
  return usePolled(useCallback(() => host.git.diff(cwd, scope, base), [cwd, scope, base]), DIFF_POLL_MS);
}

/** `githubUser` is the thread's profile GitHub account; gh's active account when undefined. */
export function usePr(cwd: string, githubUser?: string) {
  return usePolled(useCallback(() => host.git.pr(cwd, githubUser), [cwd, githubUser]), PR_POLL_MS);
}

function usePolled<T>(load: () => Promise<T>, interval: number) {
  const [result, setResult] = useState<{ data?: T; error?: string }>({});
  const latest = useRef(load);
  latest.current = load;

  const refresh = useCallback(async () => {
    try {
      const data = await load();
      if (latest.current === load) setResult({ data });
    } catch (error) {
      if (latest.current === load) setResult({ error: gitError(error) });
    }
  }, [load]);

  useEffect(() => {
    setResult({});
    void refresh();
    if (!host.isDesktop) return;
    const id = setInterval(refresh, interval);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh, interval]);

  return { ...result, isLoading: !('data' in result) && !result.error, refresh };
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
