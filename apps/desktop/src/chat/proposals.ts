import {
  PROPOSAL_TTL,
  type ActivityEntry,
  type Thread,
  type ThreadProposal,
} from '../model.ts';

/** Proposals of one kind (own_initiative) a single turn may make. */
export const PROPOSALS_PER_TURN = 3;

/** The latest turn: where it began in `activity`, and whether another thread or an automated event began it. */
export const turnOf = (thread: Thread) => thread.turn ?? { start: 0 };

export function findProposal(thread: Thread, id: string) {
  for (const entry of thread.activity) {
    const proposal = entry.proposals?.find((p) => p.id === id);
    if (proposal) return { proposal, entry };
  }
  return undefined;
}

export const isExpired = (
  proposal: ThreadProposal,
  entry: Pick<ActivityEntry, 'at'>,
  now: number,
) => proposal.state === 'pending' && now - entry.at >= PROPOSAL_TTL;

/** own_initiative proposals this turn has made, the ones since withdrawn included. */
export const turnProposalCount = (thread: Thread) =>
  thread.activity
    .slice(turnOf(thread).start)
    .flatMap((e) => e.proposals ?? [])
    .filter((p) => p.initiation === 'own_initiative').length;

export const nextProposalId = (thread: Thread) =>
  `${thread.id}-p${thread.activity.flatMap((e) => e.proposals ?? []).length + 1}`;

/** Joins this turn's card when it has one, so a turn's proposals page through one card; else a new card where the agent asked. */
export function addProposal(
  thread: Thread,
  proposal: ThreadProposal,
  entry: ActivityEntry,
): Thread {
  const at = thread.activity.findLastIndex(
    (e, i) => i >= turnOf(thread).start && !!e.proposals,
  );
  if (at < 0)
    return {
      ...thread,
      activity: [...thread.activity, { ...entry, proposals: [proposal] }],
    };
  return {
    ...thread,
    activity: thread.activity.map((e, i) =>
      i === at ? { ...e, proposals: [...e.proposals!, proposal] } : e,
    ),
  };
}

export function updateProposal(
  thread: Thread,
  id: string,
  patch: Partial<ThreadProposal>,
): Thread {
  return {
    ...thread,
    activity: thread.activity.map((e) =>
      e.proposals?.some((p) => p.id === id)
        ? {
            ...e,
            proposals: e.proposals.map((p) =>
              p.id === id ? { ...p, ...patch } : p,
            ),
          }
        : e,
    ),
  };
}

/** Why a pending proposal can't be started or answered now; undefined when it can. */
export function proposalBlocker(thread: Thread, id: string, now: number) {
  const found = findProposal(thread, id);
  if (!found) return `No proposal ${id} in this thread`;
  const { proposal, entry } = found;
  if (proposal.state !== 'pending')
    return `"${proposal.title}" was already ${STATE_WORD[proposal.state]}`;
  if (isExpired(proposal, entry, now))
    return `"${proposal.title}" expired after 7 days; propose it again if it still matters`;
  return undefined;
}

const STATE_WORD = {
  pending: 'pending',
  started: 'started',
  dismissed: 'dismissed',
  here: 'answered: the user chose to do it here',
} satisfies Record<ThreadProposal['state'], string>;

/** Do it here on a suggestion: the agent's turn already ended, so the message carries the brief it wrote. */
export const suggestionHereReply = (
  p: Pick<ThreadProposal, 'title' | 'brief'>,
) => `Do it here: ${p.title}\n\n${p.brief}`;

/** The message the agent gets when you answer its offer in place, since it stopped to wait for you. */
export const OFFER_REPLY = {
  here: 'Do it here.',
  dismissed: "Leave it, don't do that task.",
} as const;
