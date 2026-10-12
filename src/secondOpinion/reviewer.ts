import { useSyncExternalStore } from 'react';
import { host } from '../host/index.ts';
import type { Provider, Thread } from '../model.ts';
import { linkedAccountId, signInCommand } from '../settings/accounts.ts';
import { otherProvider, providerName } from './verdict.ts';

export interface Reviewer {
  provider: Provider;
  /** Why it can't review right now; unset when it can. */
  reason?: string;
}

const TTL_MS = 60_000;
/** `${spaceId}:${provider}` → why that account can't review ('' when it can), checked at most once a minute. */
const checked = new Map<string, { at: number; reason: string | null }>();
const listeners = new Set<() => void>();
let version = 0;

/**
 * Who would give `thread` a second opinion and whether it can: the other provider's account for the thread's profile
 * must be installed and signed in. Demo threads use the scripted reviewer, which always can. Reading this starts a
 * check when the cached one is missing or stale, and subscribers re-render when it lands.
 */
export function reviewerFor(thread: Thread): Reviewer {
  const provider = otherProvider(thread.providers[0]);
  if (!thread.repo) return { provider, reason: 'This chat has no project, so there is no diff to review' };
  if (!thread.live || !host.isDesktop) return { provider };
  const key = `${thread.spaceId}:${provider}`;
  const hit = checked.get(key);
  if (!hit || Date.now() - hit.at > TTL_MS) check(key, thread.spaceId, provider);
  if (!hit || hit.reason === null) return { provider, reason: `Checking whether ${providerName(provider)} is signed in…` };
  return hit.reason ? { provider, reason: hit.reason } : { provider };
}

export function useReviewer(thread: Thread): Reviewer {
  useReviewerChecks();
  return reviewerFor(thread);
}

/** Re-renders when a sign-in check lands, for lists that call `reviewerFor` (palette, context menus). */
export function useReviewerChecks() {
  useSyncExternalStore(subscribe, () => version);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

const inFlight = new Set<string>();

function check(key: string, spaceId: string, provider: Provider) {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  if (!checked.has(key)) checked.set(key, { at: 0, reason: null });
  void reasonFor(spaceId, provider)
    .catch((error: unknown) => `Couldn't check ${providerName(provider)}: ${error instanceof Error ? error.message : String(error)}`)
    .then((reason) => {
      inFlight.delete(key);
      checked.set(key, { at: Date.now(), reason });
      version++;
      listeners.forEach((listener) => listener());
    });
}

async function reasonFor(spaceId: string, provider: Provider): Promise<string> {
  const name = providerName(provider);
  const { accounts, links } = await host.settings.accounts();
  const account = accounts.find((a) => a.id === linkedAccountId(links, spaceId, provider));
  if (!account) return `No ${name} account is linked to this profile. Link one in Settings › Agents`;
  const install = await host.settings.detect(account.id);
  if (!install.path) return `${name} isn't installed. Install it, or set its path in Settings › Agents`;
  if (install.login.state === 'logged-out') return `${name} is signed out for this profile. Run \`${signInCommand(account)}\` in a terminal`;
  // 'unknown' (status unreadable) is let through: the run itself reports a real sign-in problem.
  return '';
}
