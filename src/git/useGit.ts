import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { host } from '../host/index.ts';
import { threadCwd } from '../host/cwd.ts';
import type { DiffScope, PrInfo } from '../host/types/git.ts';
import type { Thread } from '../model.ts';
import { useProfiles } from '../profiles.ts';
import { withLivePr } from './prs.ts';

const DIFF_POLL_MS = 4000;
const PR_POLL_MS = 30_000;

/** The worktree's diff (against `base`, the thread's chosen base), re-read on an interval and on window focus while the agent keeps editing. */
export function useGitDiff(cwd: string, scope: DiffScope, base?: string) {
  return usePolled(useCallback(() => host.git.diff(cwd, scope, base), [cwd, scope, base]), DIFF_POLL_MS);
}

/** `githubUser` is the thread's profile GitHub account; gh's active account when undefined. */
export function usePr(cwd: string, githubUser?: string) {
  return usePolled(useCallback(() => loadPr(cwd, githubUser), [cwd, githubUser]), PR_POLL_MS);
}

/**
 * The thread's PRs, plus its branch's live one from `gh` for a live thread on the desktop (the web build's mock would give
 * every thread the same one). The summary and the composer both read it.
 */
export function useThreadPrs(thread: Thread) {
  const cwd = host.isDesktop && thread.live ? threadCwd(thread) : null;
  const githubUser = useProfiles().find((p) => p.id === thread.spaceId)?.github || undefined;
  const prQuery = usePolled(useCallback(() => (cwd ? loadPr(cwd, githubUser) : Promise.resolve(null)), [cwd, githubUser]), PR_POLL_MS);
  return withLivePr(thread.prs, prQuery.data);
}

const PR_SHARE_MS = 5000;
const recentPrs = new Map<string, { at: number; pr: Promise<PrInfo | null> }>();

// Several readers of one branch's PR (summary, composer, ship bar) poll on their own timers; one gh call serves them all.
function loadPr(cwd: string, githubUser?: string) {
  const key = `${cwd}\u0000${githubUser ?? ''}`;
  const hit = recentPrs.get(key);
  if (hit && Date.now() - hit.at < PR_SHARE_MS) return hit.pr;
  const pr = host.git.pr(cwd, githubUser);
  recentPrs.set(key, { at: Date.now(), pr });
  return pr;
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
