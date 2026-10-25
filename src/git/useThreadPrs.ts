import { threadCwd } from '@/host/cwd';
import type { RefItem } from '../chat/RefHoverCard';
import {
  bareState,
  byAttention,
  refFromUrl,
  refLabel,
  type GithubRef,
  type RepoSlug,
} from '../chat/refs';
import { useRefStates, useRepoSlug } from '../chat/useRefState';
import type { PullRequest, Thread } from '../model';
import { useProfiles } from '../profiles';

export interface ThreadPr extends RefItem {
  pr: PullRequest;
  state: NonNullable<RefItem['state']>;
}

/**
 * The thread's PRs, most-needs-you first (newest first within a rank), each with its live state from the shared ref cache.
 * Until GitHub answers, or when it can't, a PR reads as the thread recorded it.
 */
export function useThreadPrs(
  thread: Thread | undefined,
  prs = thread?.prs ?? [],
): ThreadPr[] {
  const scope = useGithubScope(thread);
  const home = useRepoSlug(scope.cwd);
  const refs = prs.map((pr) => prRef(pr, home));
  const states = useRefStates(
    refs.filter((r) => r !== null),
    scope,
  );
  let at = 0;
  const items = prs.map((pr, i): ThreadPr => {
    const githubRef = refs[i];
    const live = githubRef ? states[at++] : null;
    return {
      pr,
      githubRef,
      label: githubRef ? refLabel(githubRef, home) : `#${pr.number}`,
      state: live ?? bareState('pr', pr.state, pr.title, pr.url ?? ''),
    };
  });
  return byAttention(items.reverse(), (item) => item.state);
}

/** One of the thread's PRs, for a row that shows it on its own. */
export function useThreadPr(thread: Thread, pr: PullRequest) {
  return useThreadPrs(thread, [pr])[0];
}

/** Where gh runs for the thread's refs, and as which account. */
export function useGithubScope(thread: Thread | undefined) {
  const githubUser =
    useProfiles().find((p) => p.id === thread?.spaceId)?.github || undefined;
  return { cwd: thread ? threadCwd(thread) : null, githubUser };
}

function prRef(pr: PullRequest, home: RepoSlug | null): GithubRef | null {
  return (
    (pr.url && refFromUrl(pr.url)) ||
    (home && { ...home, number: pr.number, kind: 'pr' })
  );
}
