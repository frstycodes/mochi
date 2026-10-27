import type { OrchestrationGrant, Thread } from '../model.ts';

/** `request_orchestration_grant`'s bounds: a grant is for one multi-phase plan, never a standing permission. */
export const GRANT_LIMITS = { maxThreads: 10, hours: 24 } as const;

/** What a grant is now: its stored state, with active read off the clock and its budget. */
export type GrantStatus =
  | Exclude<OrchestrationGrant['state'], 'active'>
  | 'active'
  | 'spent'
  | 'expired';

export function grantStatus(
  grant: OrchestrationGrant,
  now: number,
): GrantStatus {
  if (grant.state !== 'active') return grant.state;
  if (grant.started.length >= grant.maxThreads) return 'spent';
  if (grant.expiresAt !== undefined && now >= grant.expiresAt) return 'expired';
  return 'active';
}

export function findGrant(thread: Pick<Thread, 'activity'>, id: string) {
  return thread.activity.find((e) => e.grant?.id === id)?.grant;
}

/** The thread's latest allowed grant, usable or not; a newer allowed one replaces it, so there is at most one. */
export const allowedGrant = (thread: Pick<Thread, 'activity'>) =>
  thread.activity.findLast((e) => e.grant?.state === 'active')?.grant;

export const pendingGrant = (thread: Thread) =>
  thread.activity.find((e) => e.grant?.state === 'pending')?.grant;

/** The grant an agent-driven turn may start a thread on now, if any. */
export function usableGrant(thread: Pick<Thread, 'activity'>, now: number) {
  const grant = allowedGrant(thread);
  return grant && grantStatus(grant, now) === 'active' ? grant : undefined;
}

/** Whether the thread ever had a grant allowed, so an agent-driven call falls back to a card rather than failing. */
export const hadGrant = (thread: Thread) =>
  thread.activity.some(
    (e) =>
      e.grant &&
      (e.grant.state === 'active' ||
        e.grant.state === 'revoked' ||
        e.grant.state === 'replaced'),
  );

export const nextGrantId = (thread: Thread) =>
  `${thread.id}-g${thread.activity.filter((e) => e.grant).length + 1}`;

export function updateGrant(
  thread: Thread,
  id: string,
  patch: (grant: OrchestrationGrant) => Partial<OrchestrationGrant>,
): Thread {
  return {
    ...thread,
    activity: thread.activity.map((e) =>
      e.grant?.id === id
        ? { ...e, grant: { ...e.grant, ...patch(e.grant) } }
        : e,
    ),
  };
}

/** Allowing one ends the active grant before it, so a thread never holds two budgets. */
export function allowGrant(
  thread: Thread,
  id: string,
  models: string[],
  now: number,
): Thread {
  const grant = findGrant(thread, id);
  if (grant?.state !== 'pending') return thread;
  const kept = models.filter((m) => grant.models.includes(m));
  if (!kept.length) return thread;
  return {
    ...thread,
    activity: thread.activity.map((e) => {
      if (e.grant?.id === id)
        return {
          ...e,
          grant: {
            ...e.grant,
            state: 'active' as const,
            models: kept,
            expiresAt: now + e.grant.minutes,
          },
        };
      if (e.grant?.state === 'active')
        return { ...e, grant: { ...e.grant, state: 'replaced' as const } };
      return e;
    }),
  };
}

/** "3 of 5 threads left" and when it lapses, for the card and the agent. */
export const threadsLeft = (grant: OrchestrationGrant) =>
  grant.maxThreads - grant.started.length;

/** App-clock minutes as "2 h 10 min" / "45 min". */
export function durationText(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  if (!h) return `${m} min`;
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
