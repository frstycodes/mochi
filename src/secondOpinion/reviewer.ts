import { useIsFetching, useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { host } from '../host/index.ts';
import type { Provider, Thread } from '../model.ts';
import { linkedAccountId, signInCommand } from '../settings/accounts.ts';
import { otherProvider, providerName } from './verdict.ts';

export interface Reviewer {
  provider: Provider;
  /** Why it can't review right now; unset when it can. */
  reason?: string;
}

/**
 * Who would give `thread` a second opinion and whether it can: the other provider's account for the thread's profile
 * must be installed and signed in. Demo threads use the scripted reviewer, which always can. Reading this starts a
 * check when the cached one is missing or stale, and subscribers re-render when it lands.
 */
export function reviewerFor(thread: Thread): Reviewer {
  const provider = otherProvider(thread.providers[0]);
  if (!thread.repo)
    return {
      provider,
      reason: 'This chat has no project, so there is no diff to review',
    };
  if (!thread.live || !host.isDesktop) return { provider };
  const options = reviewerQuery(thread.spaceId, provider);
  const state = queryClient.getQueryState<string>(options.queryKey);
  if (!state || Date.now() - state.dataUpdatedAt > 60_000)
    void queryClient.fetchQuery(options).catch(() => {});
  const reason = state?.data;
  if (reason === undefined)
    return {
      provider,
      reason: `Checking whether ${providerName(provider)} is signed in…`,
    };
  return reason ? { provider, reason } : { provider };
}

/** `reviewerFor` that waits for the sign-in check instead of answering "Checking…", for an agent's own request. */
export async function checkReviewer(thread: Thread): Promise<Reviewer> {
  const reviewer = reviewerFor(thread);
  if (!thread.live || !host.isDesktop || !thread.repo) return reviewer;
  const reason = await queryClient.fetchQuery(
    reviewerQuery(thread.spaceId, reviewer.provider),
  );
  return reason
    ? { provider: reviewer.provider, reason }
    : { provider: reviewer.provider };
}

export function useReviewer(thread: Thread): Reviewer {
  const provider = otherProvider(thread.providers[0]);
  const reviewerQueryResult = useQuery({
    ...reviewerQuery(thread.spaceId, provider),
    enabled: !!thread.repo && !!thread.live && host.isDesktop,
  });
  if (!thread.repo)
    return {
      provider,
      reason: 'This chat has no project, so there is no diff to review',
    };
  if (!thread.live || !host.isDesktop) return { provider };
  const reason = reviewerQueryResult.data;
  return reason === undefined
    ? {
        provider,
        reason: `Checking whether ${providerName(provider)} is signed in…`,
      }
    : reason
      ? { provider, reason }
      : { provider };
}

export function useReviewerChecks() {
  useIsFetching({ queryKey: queryKeys.reviewer.all() });
}

function reviewerQuery(spaceId: string, provider: Provider) {
  return {
    queryKey: queryKeys.reviewer.check(spaceId, provider),
    staleTime: 60_000,
    queryFn: () =>
      reasonFor(spaceId, provider).catch(
        (error: unknown) =>
          `Couldn't check ${providerName(provider)}: ${error instanceof Error ? error.message : String(error)}`,
      ),
  };
}

async function reasonFor(spaceId: string, provider: Provider): Promise<string> {
  const name = providerName(provider);
  const { accounts, links } = await host.settings.accounts();
  const account = accounts.find(
    (a) => a.id === linkedAccountId(links, spaceId, provider),
  );
  if (!account)
    return `No ${name} account is linked to this profile. Link one in Settings › Harnesses`;
  const install = await host.settings.detect(account.id);
  if (!install.path)
    return `${name} isn't installed. Install it, or set its path in Settings › Harnesses`;
  if (install.login.state === 'logged-out')
    return `${name} is signed out for this profile. Run \`${signInCommand(account)}\` in a terminal`;
  // 'unknown' (status unreadable) is let through: the run itself reports a real sign-in problem.
  return '';
}
